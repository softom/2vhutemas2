-- Журнал поисковых запросов и журнал обращений к моделям ИИ (Р-113).
--
-- Решение пользователя 2026-10-12, перед поиском с ответом ИИ: «Так как дело
-- "платное"… введём БД запросов пользователей с возможностью привязки к
-- аккаунтам и БД запросов ИИ». Две служебные таблицы:
--
--   search_queries — что искали: запрос, кто (участник или гость), что нашлось;
--   ai_requests    — каждое платное обращение к модели: назначение, модель,
--                    токены, стоимость, итог. Связано с поисковым запросом,
--                    когда вызвано им.
--
-- Это учёт работы сайта, а не материал атласа: в записи и связи (Р-39) он не
-- ложится. Читает только su.

create table app.search_queries (
    id             uuid primary key default gen_random_uuid(),
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now(),
    -- Вошедший — участник; гость — без участника, с суточным псевдонимом.
    contributor_id uuid references app.contributors(id) on delete set null,
    visitor_key    text,
    query          text not null check (length(query) between 1 and 500),
    -- Условия запроса — как пришли: виды кусков и код ветви (атрибуты, не связи).
    kinds          text[],
    type_code      text,
    mode           text not null check (mode in ('hybrid', 'fulltext')),
    results_count  integer not null default 0,
    -- Было ли совпадение по словам; false — выдача только «по смыслу».
    exact          boolean not null default false,
    -- Верх выдачи на момент запроса: [{"id": 12, "found_in": "title", "score": 0.016}].
    top            jsonb not null default '[]'::jsonb,
    duration_ms    integer,
    request_id     text
);

comment on table app.search_queries is
  'Журнал поисковых запросов (Р-113): что искали, кто и что нашлось. Служебный учёт, читает su.';
comment on column app.search_queries.visitor_key is
  'Псевдоним гостя на сутки: хеш адреса, браузера и даты с секретом сервера. Сам адрес не хранится.';
comment on column app.search_queries.top is
  'Снимок верха выдачи; номера записей — атрибут снимка, а не ссылка: запись могут убрать.';

create index search_queries_created_idx on app.search_queries (created_at desc);
create index search_queries_contributor_idx on app.search_queries (contributor_id, created_at desc)
  where contributor_id is not null;
create index search_queries_visitor_idx on app.search_queries (visitor_key, created_at desc)
  where visitor_key is not null;

create table app.ai_requests (
    id              uuid primary key default gen_random_uuid(),
    created_at      timestamptz not null default now(),
    -- Кто вызвал: участник, гость (псевдоним) или сам сервис (оба пусты).
    contributor_id  uuid references app.contributors(id) on delete set null,
    visitor_key     text,
    search_query_id uuid references app.search_queries(id) on delete set null,
    -- Зачем: query_embedding — вектор запроса, index_embedding — векторы индекса,
    -- search_answer — ответ ИИ на поисковый вопрос.
    purpose         text not null,
    provider        text not null,
    model           text not null,
    items           integer,
    input_tokens    integer,
    output_tokens   integer,
    total_tokens    integer,
    cost_rub        numeric(12, 6),
    -- Счёт провайдера как пришёл — на случай сверки.
    usage           jsonb,
    status          text not null check (status in ('ok', 'error')),
    error           text,
    -- Текст ответа модели, когда он показан читателю (search_answer).
    output          text,
    duration_ms     integer,
    request_id      text
);

comment on table app.ai_requests is
  'Журнал обращений к моделям ИИ (Р-113): назначение, модель, токены, стоимость, итог. Служебный учёт, читает su.';
comment on column app.ai_requests.cost_rub is 'Стоимость по ответу провайдера, если он её сообщил; иначе пусто.';

create index ai_requests_created_idx on app.ai_requests (created_at desc);
create index ai_requests_purpose_idx on app.ai_requests (purpose, created_at desc);
create index ai_requests_contributor_idx on app.ai_requests (contributor_id, created_at desc)
  where contributor_id is not null;
create index ai_requests_visitor_idx on app.ai_requests (visitor_key, created_at desc)
  where visitor_key is not null;
create index ai_requests_query_idx on app.ai_requests (search_query_id) where search_query_id is not null;

grant select, insert, update on app.search_queries, app.ai_requests to app_api;

-- Запись запроса. Окно поиска ищет по мере набора: «мель», «мельн», «мельников»
-- — один запрос человека, а не три. Если тот же человек за последние 15 секунд
-- искал начало этой же строки с теми же условиями, строка дополняется.
create or replace function app.search_log(
    p_contributor uuid, p_visitor text, p_query text, p_kinds text[], p_type text,
    p_mode text, p_count integer, p_exact boolean, p_top jsonb, p_duration integer, p_request text)
returns uuid
language plpgsql volatile set search_path = app, pg_catalog as $$
declare found uuid;
begin
  select q.id into found from app.search_queries q
   where q.updated_at > now() - interval '15 seconds'
     and ((p_contributor is not null and q.contributor_id = p_contributor)
          or (p_contributor is null and q.contributor_id is null
              and p_visitor is not null and q.visitor_key = p_visitor))
     and q.kinds is not distinct from p_kinds and q.type_code is not distinct from p_type
     and (left(lower(p_query), length(q.query)) = lower(q.query)
          or left(lower(q.query), length(p_query)) = lower(p_query))
   order by q.updated_at desc limit 1;

  if found is not null then
    update app.search_queries
       set query = p_query, mode = p_mode, results_count = p_count, exact = p_exact, top = p_top,
           duration_ms = p_duration, request_id = p_request, updated_at = now()
     where id = found;
    return found;
  end if;

  insert into app.search_queries (contributor_id, visitor_key, query, kinds, type_code, mode,
                                  results_count, exact, top, duration_ms, request_id)
  values (p_contributor, p_visitor, p_query, p_kinds, p_type, p_mode, p_count, p_exact, p_top,
          p_duration, p_request)
  returning id into found;
  return found;
end $$;

grant execute on function app.search_log(uuid, text, text, text[], text, text, integer, boolean, jsonb, integer, text)
  to app_api;
