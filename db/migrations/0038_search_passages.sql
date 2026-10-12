-- Фрагменты для ответа ИИ в поиске (Р-114).
--
-- Решение пользователя 2026-10-12: ответ ИИ — всем, аудитория и суточный лимит
-- (для начала 50) — настройки сайта. Модель отвечает только по материалам
-- сайта, поэтому ей нужны не записи, а сами куски: название, сведения, текст.
--
-- Тот же гибридный отбор, что в app.search (0033), но выдача — куски, не
-- больше трёх на запись, чтобы одна длинная лекция не заняла весь ответ.
-- Права те же: гостю — только куски опубликованных версий.

create or replace function app.search_passages(
    p_query text, p_embedding text, p_drafts boolean,
    p_exclude_roots text[] default null, p_limit integer default 10)
returns table(entity_id bigint, kind text, block_id text, content text,
              score double precision, exact boolean, similarity double precision)
language sql stable set search_path = app, extensions, public, pg_catalog as $$
  with q as (select app.search_tsquery(p_query) as tq,
                    case when p_embedding is not null then p_embedding::vector(1536) end as qv),
  base as (
    select c.* from app.search_chunks c
      join app.entities e on e.id = c.entity_id
     where c.scope = case when p_drafts then 'working' else 'published' end
       and e.status <> 'archived' and (p_drafts or e.status = 'published')
       and (p_exclude_roots is null or e.type_id not in
              (select s from unnest(p_exclude_roots) r, app.entity_type_subtree(r) s))),
  fts as (
    select b.id, 'fulltext'::text as src,
           row_number() over (order by ts_rank_cd(b.tsv, q.tq, 1) desc, b.kind, b.chunk_no) as rn,
           null::double precision as sim
      from base b, q where q.tq is not null and b.tsv @@ q.tq
     order by rn limit 60),
  vec as (
    select b.id, 'vector'::text as src,
           row_number() over (order by b.embedding <=> q.qv) as rn,
           (1 - (b.embedding <=> q.qv))::double precision as sim
      from base b, q where q.qv is not null and b.embedding is not null
     order by rn limit 60),
  merged as (
    select h.id, sum(1.0 / (60 + h.rn))::double precision as score,
           bool_or(h.src = 'fulltext') as exact, max(h.sim) as sim
      from (select * from fts union all select * from vec) h
     group by h.id),
  ranked as (
    select c.entity_id, c.kind, c.block_id, c.content, m.score, m.exact, m.sim,
           row_number() over (partition by c.entity_id order by m.score desc) as per_entity
      from merged m join app.search_chunks c on c.id = m.id)
  select r.entity_id, r.kind, r.block_id, r.content, r.score, r.exact, r.sim
    from ranked r
   where r.per_entity <= 3
   order by r.score desc, r.entity_id
   limit p_limit;
$$;

grant execute on function app.search_passages(text, text, boolean, text[], integer) to app_api;
