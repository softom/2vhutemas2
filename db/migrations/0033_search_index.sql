-- Поисковый индекс: гибридный поиск — полнотекстовый и векторный (Р-109).
--
-- Решение пользователя 2026-10-05: «хранить векторы в pgvector»; «поиск
-- гибридный… выделять Названия, Параметры, Текст»; таблицу кусков —
-- «Утверждаю»; модель — сразу одна, «если потеряем смысл, просто перебьём
-- всю базу другой моделью».
--
-- Таблица — служебный склад, как document_entity_refs: производные данные,
-- полностью воспроизводимые из версий записей. Куски собираются из снимка
-- версии (revisions.snapshot), поэтому опубликованное и рабочее индексируются
-- раздельно: гостю отдаются только куски опубликованной версии.
--
-- Расширение vector может уже стоять в базе (его ставил Social View), поэтому
-- тип и операторы ищутся по пути поиска, а не по жёсткому имени схемы.

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'vector') then
    create schema if not exists extensions;
    create extension vector with schema extensions;
  end if;
end $$;

do $$
declare s text := (select n.nspname from pg_extension e
                     join pg_namespace n on n.oid = e.extnamespace
                    where e.extname = 'vector');
begin
  execute format('grant usage on schema %I to app_api', s);
end $$;

set local search_path = app, extensions, public, pg_catalog;

create table app.search_chunks (
    id             uuid primary key default gen_random_uuid(),
    entity_id      bigint not null references app.entities(id) on delete cascade,
    revision_id    uuid not null references app.revisions(id) on delete cascade,
    scope          text not null check (scope in ('published', 'working')),
    kind           text not null check (kind in ('title', 'params', 'text')),
    chunk_no       integer not null,
    block_id       text,
    content        text not null,
    -- Хеш того, что ушло в модель (кусок с названием записи для контекста):
    -- одинаковый текст в рабочей и опубликованной версии эмбеддится один раз.
    content_sha256 text not null,
    tsv            tsvector generated always as (
                     setweight(to_tsvector('russian'::regconfig, content),
                               (case kind when 'title' then 'A' when 'params' then 'B' else 'C' end)::"char")
                   ) stored,
    model          text,
    embedding      vector(1536),
    created_at     timestamptz not null default now(),
    embedded_at    timestamptz,
    unique (entity_id, scope, kind, chunk_no),
    check ((model is null) = (embedding is null))
);

comment on table app.search_chunks is
  'Поисковый индекс (Р-109): куски записи — название, сведения, текст — с tsvector и вектором. Производные данные, пересобираются из версий.';
comment on column app.search_chunks.scope is 'published — из опубликованной версии (видно гостю), working — из рабочей (редакторам).';
comment on column app.search_chunks.kind is 'Где найдено: title — названия и тип, params — сведения, text — текст записи.';
comment on column app.search_chunks.block_id is 'Первый блок BlockNote куска текста — для перехода к месту.';
comment on column app.search_chunks.model is 'Модель эмбеддинга; смена модели в настройке API пересчитывает все векторы.';

create index search_chunks_entity_idx on app.search_chunks (entity_id, scope);
create index search_chunks_hash_idx on app.search_chunks (content_sha256, model);
create index search_chunks_tsv_idx on app.search_chunks using gin (tsv);
create index search_chunks_embedding_idx on app.search_chunks using hnsw (embedding vector_cosine_ops);

grant select, insert, update, delete on app.search_chunks to app_api;

-- ── Сведения записи словами ──────────────────────────────────────────────────
-- «Пролёт: 43 м», «Адрес объекта: Новосибирск…», «Год: 1931–1934». Читается
-- из снимка версии, а не из рабочих таблиц: снимок неизменен.
create or replace function app.search_params_text(p_revision uuid) returns text
language sql stable set search_path = app, pg_catalog as $$
  select string_agg(line, chr(10) order by psort, vsort)
    from (
      select p.sort_order as psort, coalesce((v->>'sort_order')::int, 0) as vsort,
             p.title_ru || ': ' || concat_ws(' — ',
               nullif(concat_ws(' ',
                 trim_scale((v->>'num_value')::numeric)::text || coalesce(' ' || p.unit, ''),
                 v->>'text_value',
                 case (v->>'bool_value')::boolean when true then 'да' when false then 'нет' end,
                 o.title_ru,
                 case when v->>'date_start_year' is not null then
                   (case when (v->>'is_approximate')::boolean then 'около ' else '' end)
                   || (v->>'date_start_year')
                   || coalesce('–' || (v->>'date_end_year'), '')
                   || case when (v->>'is_ongoing')::boolean then ' — по наст. время' else '' end end,
                 x.title_ru), ''),
               nullif(btrim(v->>'note'), '')) as line,
             (v->>'num_value') is not null or nullif(btrim(v->>'text_value'), '') is not null
               or (v->>'bool_value') is not null or o.id is not null
               or (v->>'date_start_year') is not null or x.id is not null as has_value
        from app.revisions r
        cross join lateral jsonb_array_elements(r.snapshot->'values') v
        join app.parameters p on p.id = (v->>'parameter_id')::uuid
        left join app.parameter_options o on o.id = (v->>'option_id')::uuid
        left join app.entities x on x.id = (v->>'entity_value_id')::bigint
       where r.id = p_revision and p.value_type <> 'blocks'
    ) lines
   where has_value;
$$;

-- ── Исходник кусков одной версии ─────────────────────────────────────────────
-- Названия, тип, метки, сведения словами и текст (BlockNote). Режет на куски
-- API: разбор блоков уже живёт там (extractText).
create or replace function app.search_revision_source(p_revision uuid) returns jsonb
language sql stable set search_path = app, pg_catalog as $$
  select jsonb_build_object(
           'titles', jsonb_build_array(r.snapshot->'entity'->>'title_ru',
                                       r.snapshot->'entity'->>'title_original',
                                       r.snapshot->'entity'->>'title_en',
                                       r.snapshot->'entity'->>'title_la'),
           'type_title', ty.title_ru,
           'tags', coalesce((select jsonb_agg(t->>'title') from jsonb_array_elements(r.snapshot->'tags') t), '[]'),
           'params', app.search_params_text(r.id),
           'body', coalesce(r.snapshot->'body_json', '[]'))
    from app.revisions r
    left join app.entity_types ty on ty.id = (r.snapshot->'entity'->>'type_id')::uuid
   where r.id = p_revision;
$$;

-- ── Что пересобрать ──────────────────────────────────────────────────────────
-- Указатель версии сдвинулся, а куски ещё от прежней — запись в очереди.
create or replace function app.search_stale(p_limit integer)
returns table(entity_id bigint, scope text, revision_id uuid)
language sql stable set search_path = app, pg_catalog as $$
  select * from (
    select e.id, 'published', e.published_revision_id from app.entities e
     where e.status = 'published' and e.published_revision_id is not null
       and not exists (select 1 from app.search_chunks c where c.entity_id = e.id
                          and c.scope = 'published' and c.revision_id = e.published_revision_id)
    union all
    select e.id, 'working', e.working_revision_id from app.entities e
     where e.status <> 'archived' and e.working_revision_id is not null
       and not exists (select 1 from app.search_chunks c where c.entity_id = e.id
                          and c.scope = 'working' and c.revision_id = e.working_revision_id)
  ) q order by 1 limit p_limit;
$$;

-- Снятое с публикации и убранное в архив из выдачи уходит сразу.
create or replace function app.search_prune() returns integer
language sql volatile set search_path = app, pg_catalog as $$
  with gone as (
    delete from app.search_chunks c using app.entities e
     where e.id = c.entity_id
       and ((c.scope = 'published' and e.status <> 'published') or e.status = 'archived')
    returning 1)
  select count(*)::int from gone;
$$;

-- Заменить куски записи в одной области. Вектор переносится с любого куска
-- с тем же содержимым и моделью — повторно в модель текст не уходит.
create or replace function app.search_put(p_entity bigint, p_scope text, p_revision uuid, p_chunks jsonb)
returns integer
language plpgsql volatile set search_path = app, extensions, public, pg_catalog as $$
declare
  old jsonb;
  n integer;
begin
  select coalesce(jsonb_object_agg(h, jsonb_build_array(m, v)), '{}') into old
    from (select distinct on (c.content_sha256) c.content_sha256 as h, c.model as m, c.embedding::text as v
            from app.search_chunks c
           where c.embedding is not null
             and c.content_sha256 in (select x->>'hash' from jsonb_array_elements(p_chunks) x)
           order by c.content_sha256, c.embedded_at desc) found;

  delete from app.search_chunks where entity_id = p_entity and scope = p_scope;

  insert into app.search_chunks (entity_id, revision_id, scope, kind, chunk_no, block_id, content,
                                 content_sha256, model, embedding, embedded_at)
  select p_entity, p_revision, p_scope, x->>'kind', (x->>'chunk_no')::int, x->>'block_id',
         x->>'content', x->>'hash', old->(x->>'hash')->>0,
         (old->(x->>'hash')->>1)::vector(1536),
         case when old ? (x->>'hash') then now() end
    from jsonb_array_elements(p_chunks) x;
  get diagnostics n = row_count;
  return n;
end $$;

-- Куски без вектора текущей модели.
create or replace function app.search_pending(p_model text, p_limit integer)
returns table(id uuid, content_sha256 text)
language sql stable set search_path = app, pg_catalog as $$
  select c.id, c.content_sha256 from app.search_chunks c
   where c.model is distinct from p_model
   order by c.scope, c.entity_id, c.kind, c.chunk_no
   limit p_limit;
$$;

-- Записать векторы: [{"hash": "...", "embedding": [..]}] — всем кускам с этим содержимым.
create or replace function app.search_set_embeddings(p_model text, p_items jsonb) returns integer
language plpgsql volatile set search_path = app, extensions, public, pg_catalog as $$
declare n integer;
begin
  update app.search_chunks c
     set model = p_model, embedding = (x->>'embedding')::vector(1536), embedded_at = now()
    from jsonb_array_elements(p_items) x
   where c.content_sha256 = x->>'hash';
  get diagnostics n = row_count;
  return n;
end $$;

-- ── Запрос ───────────────────────────────────────────────────────────────────
-- Слова запроса — префиксами: «Мельник» находит «Мельникова», пока человек
-- ещё печатает. Все слова обязательны; смысловые совпадения даёт вектор.
create or replace function app.search_tsquery(p_query text) returns tsquery
language sql immutable set search_path = pg_catalog as $$
  select case when count(*) = 0 then null
              else to_tsquery('russian'::regconfig, string_agg(w || ':*', ' & ')) end
    from (select (regexp_matches(lower(coalesce(p_query, '')), '[[:alnum:]]+', 'g'))[1] as w) words;
$$;

-- Гибридная выдача: два списка — полнотекстовый и векторный — сливаются по
-- местам (RRF, k = 60) с весом вида куска: название сильнее сведений, сведения
-- сильнее текста. Запись получает лучший кусок — он и показывается: где
-- найдено и фрагмент (совпавшие слова между знаками U+E000 и U+E001).
-- Права: гость видит только куски опубликованных версий.
create or replace function app.search(
    p_query text, p_embedding text, p_drafts boolean,
    p_kinds text[] default null, p_type text default null,
    p_exclude_roots text[] default null, p_limit integer default 20)
returns table(entity_id bigint, score double precision, kind text, block_id text,
              snippet text, matched text[], similarity double precision)
language sql stable set search_path = app, extensions, public, pg_catalog as $$
  with q as (select app.search_tsquery(p_query) as tq,
                    case when p_embedding is not null then p_embedding::vector(1536) end as qv),
  base as (
    select c.* from app.search_chunks c
      join app.entities e on e.id = c.entity_id
     where c.scope = case when p_drafts then 'working' else 'published' end
       and e.status <> 'archived' and (p_drafts or e.status = 'published')
       and (p_kinds is null or c.kind = any(p_kinds))
       and (p_type is null or e.type_id in (select app.entity_type_subtree(p_type)))
       and (p_type is not null or p_exclude_roots is null or e.type_id not in
              (select s from unnest(p_exclude_roots) r, app.entity_type_subtree(r) s))),
  fts as (
    select b.id, b.entity_id, b.kind, 'fulltext'::text as src,
           row_number() over (order by ts_rank_cd(b.tsv, q.tq, 1) desc, b.kind, b.chunk_no) as rn,
           null::double precision as sim
      from base b, q where q.tq is not null and b.tsv @@ q.tq
     order by rn limit 100),
  vec as (
    select b.id, b.entity_id, b.kind, 'vector'::text as src,
           row_number() over (order by b.embedding <=> q.qv) as rn,
           (1 - (b.embedding <=> q.qv))::double precision as sim
      from base b, q where q.qv is not null and b.embedding is not null
     order by rn limit 100),
  hits as (
    select h.*, (case h.kind when 'title' then 1.0 when 'params' then 0.7 else 0.5 end) / (60 + h.rn) as s
      from (select * from fts union all select * from vec) h),
  per_source as (select h.entity_id, h.src, max(h.s) as s from hits h group by 1, 2),
  totals as (select p.entity_id, sum(p.s)::double precision as score,
                    array_agg(p.src order by p.src) as matched
               from per_source p group by 1),
  best as (select distinct on (h.entity_id) h.entity_id, h.id from hits h order by h.entity_id, h.s desc),
  sims as (select h.entity_id, max(h.sim) as sim from hits h where h.sim is not null group by 1)
  select t.entity_id, t.score, c.kind, c.block_id,
         case when q.tq is not null and c.tsv @@ q.tq
              then ts_headline('russian'::regconfig, c.content, q.tq,
                               'StartSel=' || chr(57344) || ', StopSel=' || chr(57345)
                               || ', MaxWords=35, MinWords=15, MaxFragments=2, FragmentDelimiter=" … "')
              else left(c.content, 240) end,
         t.matched, s.sim
    from totals t
    join best b on b.entity_id = t.entity_id
    join app.search_chunks c on c.id = b.id
    left join sims s on s.entity_id = t.entity_id
    cross join q
   order by t.score desc, t.entity_id
   limit p_limit;
$$;

-- Состояние индекса — для страницы su и проверки после выкладки.
create or replace function app.search_status(p_model text) returns jsonb
language sql stable set search_path = app, pg_catalog as $$
  select jsonb_build_object(
    'chunks', (select count(*) from app.search_chunks),
    'by_scope', (select coalesce(jsonb_object_agg(scope, n), '{}') from
                  (select scope, count(*) n from app.search_chunks group by 1) x),
    'by_kind', (select coalesce(jsonb_object_agg(kind, n), '{}') from
                  (select kind, count(*) n from app.search_chunks group by 1) x),
    'entities', (select count(distinct entity_id) from app.search_chunks),
    'embedded', (select count(*) from app.search_chunks where model = p_model),
    'pending_embeddings', (select count(*) from app.search_chunks where model is distinct from p_model),
    'stale_entities', (select count(*) from app.search_stale(100000)));
$$;

grant execute on function app.search_params_text(uuid), app.search_revision_source(uuid),
  app.search_stale(integer), app.search_prune(), app.search_put(bigint, text, uuid, jsonb),
  app.search_pending(text, integer), app.search_set_embeddings(text, jsonb),
  app.search_tsquery(text), app.search(text, text, boolean, text[], text, text[], integer),
  app.search_status(text) to app_api;
