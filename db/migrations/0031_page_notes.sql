-- Пометки на страницах сайта (Р-95): замечания редакторов прямо поверх живой
-- страницы — комментарий-булавка, стикер, текст, карандаш, рамка, стрелка.
--
-- Решение пользователя 2026-10-03: «Давай сделаем» — служебная таблица для
-- разметки страниц, рисуют и видят редакторы и su. Это рабочая переписка о
-- сайте, а не материал атласа: в записи и связи (Р-39) она не ложится, на
-- страницах для читателей и в выдаче поиска не появляется.
--
-- Адрес страницы — внешний атрибут (как URL источника), не ссылка; связь с
-- записью, когда страница — запись, идёт по её номеру (правило 1).

create table app.page_notes (
    id             uuid primary key default gen_random_uuid(),
    page_path      text not null check (page_path like '/%'),
    entity_id      bigint references app.entities(id) on delete set null,
    parent_id      uuid references app.page_notes(id) on delete cascade,
    kind           text not null check (kind in ('comment', 'sticky', 'text', 'pen', 'rect', 'arrow', 'reply')),
    -- Привязка к элементу страницы: путь селектора и положение внутри него
    -- в долях — вёрстка резиновая, пиксели при другой ширине окна уезжают.
    anchor         jsonb not null default '{}'::jsonb,
    -- Форма пометки в долях от её рамки: точки карандаша, размер рамки, концы стрелки.
    geometry       jsonb not null default '{}'::jsonb,
    body           text not null default '' check (length(body) <= 4000),
    color          text not null default 'red' check (color in ('red', 'ink', 'orange', 'blue', 'green')),
    viewport_width integer check (viewport_width between 200 and 10000),
    status         text not null default 'open' check (status in ('open', 'resolved')),
    resolved_at    timestamptz,
    resolved_by    uuid references app.contributors(id),
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now(),
    created_by     uuid references app.contributors(id),
    updated_by     uuid references app.contributors(id),
    -- Ответ живёт только в ветке и сам места на странице не занимает.
    check ((kind = 'reply') = (parent_id is not null))
);

comment on table app.page_notes is
  'Пометки редакторов поверх страниц сайта (Р-95): ветки замечаний и рисунки. Служебные, читателям не показываются.';
comment on column app.page_notes.page_path is 'Адрес страницы без домена и параметров; атрибут, не связь.';
comment on column app.page_notes.anchor is 'Элемент, к которому привязана пометка: {"selector": "...", "x": 0..1, "y": 0..1}.';
comment on column app.page_notes.viewport_width is 'Ширина окна, при которой поставлена пометка: вёрстка при другой ширине иная.';

create index page_notes_page_idx on app.page_notes (page_path, status) where parent_id is null;
create index page_notes_parent_idx on app.page_notes (parent_id) where parent_id is not null;

create trigger page_notes_audit_trg before insert or update on app.page_notes
  for each row execute function app.tg_set_audit();

grant select, insert, update, delete on app.page_notes to app_api;
