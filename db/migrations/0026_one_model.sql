-- 0026. Одна модель: всё, на что ссылаются, — запись; сведения — параметры;
-- использование — связь; вид — таблица отображений.
--
-- Решения пользователя 2026-10-01: Р-84 (файл, документ и источник — типы в
-- дереве, их сведения — параметры), Р-85 (место — запись, отношение к месту —
-- параметр записи со ссылкой на место), Р-86 (текст — тип параметра, всё одним
-- переходом). Схема — «Схема данных — источники и отображения», раздел 6.
--
-- Порядок внутри миграции важен: сначала новые типы, параметры и вид значения,
-- затем перенос данных, и только потом снятие прежних таблиц. Миграция идёт
-- одной транзакцией (tools/migrate.py), так что половинчатого состояния не
-- бывает: либо всё, либо ничего.

-- ── 0. Служебное: адрес записи из названия, исполнитель переноса ─────────────

-- Слаг из русского названия: транслитерация и дефисы. Тот же вид, что делает
-- клиент, чтобы перенесённые записи не отличались от заведённых руками.
-- Буквы, которые пишутся двумя латинскими, заменяются отдельно: translate
-- умеет только букву на букву. Твёрдый и мягкий знаки отбрасываются.
create function app.slugify(p_title text) returns text language sql immutable as $$
  select trim(both '-' from left(regexp_replace(
    replace(replace(replace(replace(replace(replace(replace(replace(
      translate(lower(coalesce(p_title, '')),
        'абвгдезийклмнопрстуфыэёъь', 'abvgdeziyklmnoprstufyee'),
      'ж', 'zh'), 'х', 'h'), 'ц', 'ts'), 'ч', 'ch'), 'ш', 'sh'), 'щ', 'sch'),
      'ю', 'yu'), 'я', 'ya'),
    '[^a-z0-9]+', '-', 'g'), 60))
$$;

-- Свободный слаг: база, а при занятости — с номером. Учитываются и прежние
-- адреса: занятый когда-то адрес новой записи не отдаём.
create function app.unique_slug(p_base text) returns text language plpgsql as $$
declare
  base text := coalesce(nullif(app.slugify(p_base), ''), 'zapis');
  candidate text := base;
  n integer := 1;
begin
  while exists (select 1 from app.entities where slug = candidate)
     or exists (select 1 from app.slug_history where slug = candidate) loop
    n := n + 1;
    candidate := base || '-' || n;
  end loop;
  return candidate;
end $$;

-- ── 1. Типы: «Где — Место», «Материалы — Изображение, Документ» ─────────────

insert into app.entity_types (parent_id, code, title_ru, sort_order)
values (null, 'where', 'Где', 35),
       (null, 'materials', 'Материалы', 45);

insert into app.entity_types (parent_id, code, title_ru, sort_order)
select id, 'place', 'Место', 10 from app.entity_types where code = 'where';

insert into app.entity_types (parent_id, code, title_ru, sort_order)
select id, x.code, x.title, x.sort
  from app.entity_types, (values ('image', 'Изображение', 10),
                                 ('document', 'Документ', 20)) as x(code, title, sort)
 where entity_types.code = 'materials';

-- ── 2. Вид значения: ссылка на запись и текст ────────────────────────────────

-- Ответ параметра может быть другой записью: адрес объекта — запись «Место».
-- Какой ветвью ограничен ответ — сведение самого параметра.
alter table app.parameters
  add column value_entity_type_id uuid references app.entity_types(id);

comment on column app.parameters.value_entity_type_id is
  'Для ответа-записи: из какой ветви дерева берётся ответ (Р-85).';

alter table app.indicator_values
  add column entity_value_id bigint references app.entities(id) on delete restrict,
  add column blocks_value jsonb;

comment on column app.indicator_values.entity_value_id is
  'Ответ-запись: адрес объекта, место рождения и подобное (Р-85).';
comment on column app.indicator_values.blocks_value is
  'Ответ-текст: блоки МультиТекста (Р-86).';

alter table app.parameters drop constraint parameters_value_type_check;
alter table app.indicator_values drop constraint indicator_values_one_value_chk;

create or replace function app.tg_indicator_value_matches_type() returns trigger
language plpgsql as $$
declare
    parameter record;
begin
    select value_type, is_repeatable, title_ru, value_entity_type_id into parameter
      from app.parameters where id = new.parameter_id;
    if not found then
        raise exception 'Неизвестный параметр' using errcode = 'foreign_key_violation';
    end if;

    if parameter.value_type in ('number', 'integer') and new.num_value is null then
        raise exception 'Параметру нужен числовой ответ' using errcode = 'check_violation';
    end if;
    if parameter.value_type = 'integer' and new.num_value <> trunc(new.num_value) then
        raise exception 'Параметр считается целым числом' using errcode = 'check_violation';
    end if;
    if parameter.value_type = 'text' and new.text_value is null then
        raise exception 'Параметру нужен текстовый ответ' using errcode = 'check_violation';
    end if;
    if parameter.value_type = 'boolean' and new.bool_value is null then
        raise exception 'Параметру нужен ответ да или нет' using errcode = 'check_violation';
    end if;
    if parameter.value_type = 'option' then
        if new.option_id is null then
            raise exception 'Параметру нужно значение из списка' using errcode = 'check_violation';
        end if;
        if not exists (select 1 from app.parameter_options o
                        where o.id = new.option_id and o.parameter_id = new.parameter_id) then
            raise exception 'Значение из списка другого параметра'
                using errcode = 'check_violation';
        end if;
    end if;
    if parameter.value_type = 'date' and new.date_start_year is null then
        raise exception 'Параметру нужна дата' using errcode = 'check_violation';
    end if;
    if parameter.value_type = 'entity' then
        if new.entity_value_id is null then
            raise exception 'Параметру нужна запись-ответ' using errcode = 'check_violation';
        end if;
        -- Ответ должен лежать в той ветви, которую назначил параметр: адрес —
        -- место, а не человек.
        if parameter.value_entity_type_id is not null and not exists (
            select 1 from app.entities e
             where e.id = new.entity_value_id
               and parameter.value_entity_type_id in (select app.entity_type_ancestors(e.type_id)))
        then
            raise exception 'Ответ «%» должен быть записью другой ветви', parameter.title_ru
                using errcode = 'check_violation';
        end if;
    end if;
    if parameter.value_type = 'blocks' and new.blocks_value is null then
        raise exception 'Параметру нужен текст' using errcode = 'check_violation';
    end if;

    if not parameter.is_repeatable and exists (
        select 1 from app.indicator_values other
         where other.indicator_id = new.indicator_id
           and other.parameter_id = new.parameter_id
           and other.id <> new.id)
    then
        raise exception 'Параметр уже заполнен в этих показателях'
            using errcode = 'check_violation';
    end if;
    return new;
end;
$$;

-- ── 3. Связи прежних хранилищ с записями ─────────────────────────────────────

-- Прежнее место → запись: старые снимки версий хранят place_id, по этой
-- колонке они находят запись и после снятия справочника.
alter table app.entities add column legacy_place_id uuid unique;

-- Реестр файла остаётся техническим хранилищем; хозяин сведений — запись.
alter table app.media_assets add column entity_id bigint unique references app.entities(id);

-- Прежние тексты остаются историей, а принадлежность больше не выводится из
-- присоединений: она записана прямо в документе.
alter table app.documents
  add column owner_entity_id bigint references app.entities(id),
  add column owner_link_id bigint references app.links(id);

-- Источник группы сведений — запись-источник, а не строка мёртвого реестра.
alter table app.indicators add column source_entity_id bigint references app.entities(id);

-- ── 4. Параметры и наборы новых типов ────────────────────────────────────────

insert into app.parameters (code, title_ru, value_type, unit, definition, sort_order) values
  ('text', 'Текст', 'blocks', null,
   'Собственный МультиТекст записи: описание здания, текст лекции. Какие записи им владеют, решает набор ветви (Р-86).', 1),
  ('country', 'Страна', 'text', null, 'Страна, в которой находится место.', 10),
  ('settlement', 'Населённый пункт', 'text', null, 'Город, село, посёлок.', 20),
  ('street', 'Улица', 'text', null, 'Улица, проспект, площадь.', 30),
  ('house', 'Дом', 'text', null, 'Номер дома, строения.', 40),
  ('unit', 'Помещение', 'text', null, 'Квартира, офис, помещение внутри здания.', 50),
  ('latitude', 'Широта', 'number', '°', 'Географическая широта в десятичных градусах.', 60),
  ('longitude', 'Долгота', 'number', '°', 'Географическая долгота в десятичных градусах.', 70),
  ('coord_precision', 'Точность', 'option', null, 'С какой точностью известно положение.', 80),
  ('info_source_url', 'Источник сведений', 'text', null, 'Откуда взято положение места.', 90),
  ('image_kind', 'Вид изображения', 'option', null, 'Фотография, план, разрез и другие.', 10),
  ('image_author', 'Автор изображения', 'text', null, 'Автор съёмки или рисунка.', 20),
  ('rights_holder', 'Правообладатель', 'text', null, 'Кому принадлежат права, если автор неизвестен или права переданы.', 30),
  ('image_source_url', 'Адрес источника', 'text', null, 'Откуда взято изображение.', 40),
  ('source_caption', 'Подпись источника', 'text', null, 'Подпись изображения в источнике.', 50),
  ('holder', 'Место хранения', 'text', null, 'Музей, архив, собрание.', 60),
  ('inventory_no', 'Инвентарный номер', 'text', null, 'Номер в месте хранения.', 70),
  ('created_year', 'Год создания', 'integer', null, 'Год съёмки или рисунка.', 80),
  ('license', 'Лицензия', 'text', null, 'Условия использования.', 90),
  ('alt_text', 'Описание для незрячих', 'text', null, 'Что изображено — для чтения с экрана.', 100),
  ('image_description', 'Описание', 'text', null, 'Пояснение к изображению.', 110);

insert into app.parameter_options (parameter_id, code, title_ru, sort_order)
select p.id, x.code, x.title, x.sort
  from app.parameters p,
       (values ('point', 'Точка', 5), ('building', 'До здания', 10),
               ('settlement', 'До населённого пункта', 20), ('region', 'До региона', 30))
         as x(code, title, sort)
 where p.code = 'coord_precision';

-- Виды изображения переезжают из словаря в варианты параметра.
insert into app.parameter_options (parameter_id, code, title_ru, sort_order)
select p.id, k.code, k.title_ru, row_number() over (order by k.title_ru)::int * 10
  from app.parameters p, app.media_kinds k
 where p.code = 'image_kind';

insert into app.parameter_sets (code, title_ru, note, sort_order) values
  ('text_body', 'Текст', 'Собственный МультиТекст записи (Р-86).', 5),
  ('place_basic', 'Место — сведения', 'Положение и адрес места (Р-85).', 50),
  ('image_basic', 'Изображение — сведения', 'Автор, источник и права изображения (Р-84, Р-68).', 60);

insert into app.parameter_set_items (set_id, parameter_id, sort_order)
select s.id, p.id, p.sort_order
  from app.parameter_sets s join app.parameters p on
       (s.code = 'text_body' and p.code = 'text')
    or (s.code = 'place_basic' and p.code in ('country', 'settlement', 'street', 'house', 'unit',
                                              'latitude', 'longitude', 'coord_precision',
                                              'info_source_url'))
    or (s.code = 'image_basic' and p.code in ('image_kind', 'image_author', 'rights_holder',
                                              'image_source_url', 'source_caption', 'holder',
                                              'inventory_no', 'created_year', 'license',
                                              'alt_text', 'image_description'));

-- Текст есть у тех ветвей, где он сейчас бывает: у мест и изображений его нет.
insert into app.type_parameter_sets (type_id, set_id)
select t.id, s.id from app.entity_types t, app.parameter_sets s
 where s.code = 'text_body' and t.code in ('who', 'what', 'when', 'service', 'project_pages', 'document');
insert into app.type_parameter_sets (type_id, set_id)
select t.id, s.id from app.entity_types t, app.parameter_sets s
 where (s.code = 'place_basic' and t.code = 'place') or (s.code = 'image_basic' and t.code = 'image');

-- Отношение к месту — параметр записи со ссылкой на запись-место.
update app.parameters
   set value_type = 'entity',
       value_entity_type_id = (select id from app.entity_types where code = 'place')
 where value_type = 'place';

-- Связь-иллюстрация: изображение, использованное записью.
insert into app.link_roles (code, title_ru, sort_order) values ('illustration', 'Иллюстрация', 100);

-- ── 5. Таблица отображений ───────────────────────────────────────────────────

create table app.type_presentations (
    id         uuid primary key default gen_random_uuid(),
    type_id    uuid not null references app.entity_types(id) on delete cascade,
    mode       text not null check (mode in ('compact', 'card', 'editor')),
    settings   jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    created_by uuid references app.contributors(id),
    updated_by uuid references app.contributors(id),
    unique (type_id, mode)
);

comment on table app.type_presentations is
  'Как запись выглядит: компактно (в тексте и списке), карточкой, в редакторе. Берётся ближайшая настройка вверх по дереву типов.';

create table app.type_presentation_items (
    id              uuid primary key default gen_random_uuid(),
    presentation_id uuid not null references app.type_presentations(id) on delete cascade,
    component       text not null check (component in (
        'title', 'thumbnail', 'portrait', 'mark', 'parameter',
        'indicators', 'links', 'text', 'gallery', 'sources', 'mentions', 'citation')),
    sort_order      integer not null default 0,
    settings        jsonb not null default '{}'::jsonb,
    parameter_id    uuid references app.parameters(id),
    link_role_id    uuid references app.link_roles(id)
);

comment on table app.type_presentation_items is
  'Компоненты вида по порядку. Компонент читает данные самой записи: название, обложку, параметр, связи.';

create trigger type_presentations_audit_trg before insert or update on app.type_presentations
  for each row execute function app.tg_set_audit();

-- Начальные настройки повторяют то, что до сих пор делал код, — переход
-- не меняет облик сайта. Дальше вид правится данными, а не кодом.
insert into app.type_presentations (type_id, mode)
select t.id, m.mode
  from app.entity_types t, (values ('compact'), ('card')) as m(mode)
 where t.code in ('who', 'what', 'when', 'where', 'materials', 'service', 'project_pages',
                  'web_page', 'book', 'article', 'image');

-- Компактный вид: как запись стоит в строке текста и в списке.
insert into app.type_presentation_items (presentation_id, component, sort_order, parameter_id)
select tp.id, x.component, x.sort,
       (select id from app.parameters where code = x.parameter)
  from app.type_presentations tp
  join app.entity_types t on t.id = tp.type_id
  join (values
    ('what', 'thumbnail', 10, null), ('what', 'title', 20, null),
    ('who', 'portrait', 10, null), ('who', 'title', 20, null),
    ('when', 'title', 10, null),
    ('service', 'title', 10, null),
    ('project_pages', 'title', 10, null),
    ('where', 'title', 10, null), ('where', 'parameter', 20, 'settlement'),
    ('materials', 'title', 10, null),
    ('image', 'thumbnail', 10, null), ('image', 'title', 20, null),
    ('web_page', 'mark', 10, null), ('book', 'mark', 10, null), ('article', 'mark', 10, null)
  ) as x(type_code, component, sort, parameter) on x.type_code = t.code
 where tp.mode = 'compact';

-- Карточка: порядок разделов страницы записи.
insert into app.type_presentation_items (presentation_id, component, sort_order, link_role_id)
select tp.id, x.component, x.sort,
       (select id from app.link_roles where code = x.role)
  from app.type_presentations tp
  join app.entity_types t on t.id = tp.type_id
  join (values ('indicators', 10, null), ('links', 20, null), ('text', 30, null),
               ('gallery', 40, 'illustration'), ('sources', 50, 'source'),
               ('mentions', 60, null), ('citation', 70, null))
       as x(component, sort, role) on true
 where tp.mode = 'card' and t.parent_id is null;

-- Источнику и изображению хватает сведений, текста и упоминаний.
insert into app.type_presentation_items (presentation_id, component, sort_order)
select tp.id, x.component, x.sort
  from app.type_presentations tp
  join app.entity_types t on t.id = tp.type_id
  join (values ('indicators', 10), ('text', 20), ('mentions', 30), ('citation', 40))
       as x(component, sort) on true
 where tp.mode = 'card' and t.code in ('web_page', 'book', 'article', 'image');

-- ── 6. Снимок версии: текст — значение параметра ─────────────────────────────

-- Текст записи хранится значением параметра «Текст». В снимке он лежит ещё и
-- под ключом body_json: это проекция для чтения, а не второй источник —
-- снимок неизменен и всегда собирается из значений. Тексты в общий список
-- величин снимка не попадают: им не место среди чисел и дат.
create or replace function app.entity_snapshot(p_id bigint, p_body jsonb default null) returns jsonb
language sql stable as $$
 select jsonb_build_object('entity', to_jsonb(e) - 'published_revision_id' - 'working_revision_id',
   'body_json', coalesce((select v.blocks_value from app.indicator_values v
                            join app.indicators i on i.id = v.indicator_id
                            join app.parameters p on p.id = v.parameter_id
                           where i.entity_id = e.id and p.code = 'text'
                           order by i.sort_order, v.sort_order limit 1), '[]'::jsonb),
   'indicators', coalesce((select jsonb_agg(to_jsonb(i) order by i.sort_order, i.id)
                             from app.indicators i where i.entity_id = e.id), '[]'::jsonb),
   'values', coalesce((select jsonb_agg(to_jsonb(v) order by v.id)
                         from app.indicator_values v
                         join app.indicators i on i.id = v.indicator_id
                         join app.parameters p on p.id = v.parameter_id
                        where i.entity_id = e.id and p.value_type <> 'blocks'), '[]'::jsonb),
   'tags', coalesce((select jsonb_agg(to_jsonb(t) order by t.title)
                       from app.entity_tags et join app.tags t on t.id = et.tag_id
                      where et.entity_id = e.id), '[]'::jsonb))
 from app.entities e where e.id = p_id;
$$;

-- ── 7. Перенос данных ────────────────────────────────────────────────────────

do $$
declare
  su uuid := (select c.id from app.contributors c
                join app.user_roles ur on ur.contributor_id = c.id
                join app.roles r on r.id = ur.role_id
               where r.code = 'su' order by c.created_at limit 1);
  t_place uuid := (select id from app.entity_types where code = 'place');
  t_image uuid := (select id from app.entity_types where code = 'image');
  t_document uuid := (select id from app.entity_types where code = 'document');
  role_illustration uuid := (select id from app.link_roles where code = 'illustration');
  pl record; fa record; att record; doc record; ent record;
  new_id bigint; mat uuid; ind uuid; author_id uuid; link_id bigint; caption text;

  doc_status text;
begin
  -- 7.1. Места → записи «Место».
  for pl in select * from app.places order by created_at, id loop
    insert into app.entities (slug, title_ru, type_id, legacy_place_id, created_by, created_at)
    values (app.unique_slug(concat_ws(' ', pl.settlement, pl.street, pl.house)),
            coalesce(nullif(concat_ws(', ', nullif(pl.settlement, ''),
                                      nullif(concat_ws(' ', nullif(pl.street, ''), nullif(pl.house, '')), ''),
                                      nullif(pl.unit, '')), ''),
                     nullif(pl.country, ''), 'Место без названия'),
            t_place, pl.id, coalesce(pl.created_by, su), pl.created_at)
    returning id into new_id;

    insert into app.indicators (entity_id, title, is_current, sort_order)
    values (new_id, 'Сведения', true, 0) returning id into ind;

    insert into app.indicator_values (indicator_id, parameter_id, text_value, sort_order)
    select ind, p.id, x.val, 0 from app.parameters p
      join (values ('country', pl.country), ('settlement', pl.settlement), ('street', pl.street),
                   ('house', pl.house), ('unit', pl.unit), ('info_source_url', pl.source_url))
           as x(code, val) on x.code = p.code
     where nullif(btrim(x.val), '') is not null;
    insert into app.indicator_values (indicator_id, parameter_id, num_value, sort_order)
    select ind, p.id, x.val, 0 from app.parameters p
      join (values ('latitude', pl.lat::numeric), ('longitude', pl.lon::numeric)) as x(code, val)
        on x.code = p.code
     where x.val is not null;
    if pl.precision is not null then
      insert into app.indicator_values (indicator_id, parameter_id, option_id, sort_order)
      select ind, p.id, o.id, 0 from app.parameters p
        join app.parameter_options o on o.parameter_id = p.id and o.code = pl.precision
       where p.code = 'coord_precision';
    end if;

    -- Места и раньше показывались гостю вместе с опубликованной записью.
    insert into app.materials (kind, entity_id, created_by) values ('entity', new_id, coalesce(pl.created_by, su))
    returning id into mat;
    insert into app.material_credits (material_id, contributor_id, credit_role)
    values (mat, coalesce(pl.created_by, su), 'author');
    insert into app.revisions (material_id, edited_by, operation, summary, snapshot)
    values (mat, coalesce(pl.created_by, su), 'create', 'Р-85: место стало записью', '{}'::jsonb);
    update app.entities set status = 'published', published_revision_id = working_revision_id
     where id = new_id;
  end loop;

  -- 7.2. Ответы «место» → ссылки на записи-места.
  update app.indicator_values v
     set entity_value_id = e.id
    from app.entities e
   where e.legacy_place_id = v.place_id;

  -- 7.3. Связь «расположение» → значение «Адрес объекта» (решение пользователя).
  for ent in
    select l.id as link_id, l.from_entity_id, l.to_entity_id
      from app.links l join app.link_roles r on r.id = l.role_id
     where r.code = 'location' and l.status <> 'archived'
  loop
    if exists (select 1 from app.entities e where e.id = ent.to_entity_id and e.type_id = t_place) then
      select i.id into ind from app.indicators i
       where i.entity_id = ent.from_entity_id order by i.is_current desc, i.sort_order, i.id limit 1;
      if ind is null then
        insert into app.indicators (entity_id, title, is_current, sort_order)
        values (ent.from_entity_id, 'Сведения', true, 0) returning id into ind;
      end if;
      insert into app.indicator_values (indicator_id, parameter_id, entity_value_id, sort_order)
      select ind, p.id, ent.to_entity_id, 0 from app.parameters p
       where p.code = 'address'
         and not exists (select 1 from app.indicator_values x where x.indicator_id = ind and x.parameter_id = p.id);
    end if;
    update app.links set status = 'archived', published_revision_id = null where id = ent.link_id;
  end loop;

  -- 7.4. Принадлежность прежних текстов — прямо в документе.
  update app.documents d set owner_entity_id = t.entity_id, owner_link_id = t.link_id
    from app.attachments a
    join app.targets t on t.id = a.target_id
    join app.attachment_roles ar on ar.id = a.role_id
   where a.document_id = d.id and ar.code in ('description', 'wiki', 'justification');

  -- 7.5. Самостоятельные тексты → записи «Документ» со своим текстом.
  for doc in select * from app.documents where owner_entity_id is null and owner_link_id is null loop
    insert into app.entities (slug, title_ru, type_id, created_by, created_at)
    values (app.unique_slug(coalesce(doc.title, 'dokument')), coalesce(nullif(doc.title, ''), 'Документ'),
            t_document, coalesce(doc.created_by, su), doc.created_at)
    returning id into new_id;
    insert into app.indicators (entity_id, title, is_current, sort_order)
    values (new_id, 'Текст', true, 1000) returning id into ind;
    insert into app.indicator_values (indicator_id, parameter_id, blocks_value, sort_order)
    select ind, id, doc.body_json, 0 from app.parameters where code = 'text';
    select m.id, m.status, m.created_by into mat, doc_status, author_id
      from app.materials m where m.document_id = doc.id;
    insert into app.materials (kind, entity_id, created_by)
    values ('entity', new_id, coalesce(author_id, doc.created_by, su)) returning id into mat;
    insert into app.material_credits (material_id, contributor_id, credit_role)
    values (mat, coalesce(author_id, doc.created_by, su), 'author');
    insert into app.revisions (material_id, edited_by, operation, summary, snapshot)
    values (mat, coalesce(author_id, doc.created_by, su), 'create', 'Р-84: документ стал записью', '{}'::jsonb);
    if doc_status = 'published' then
      update app.entities set status = 'published', published_revision_id = working_revision_id where id = new_id;
    end if;
    update app.documents set owner_entity_id = new_id where id = doc.id;
  end loop;

  -- 7.6. Файлы → записи «Изображение»; сведения — параметры.
  for fa in
    select ma.*, m.status as material_status, m.created_by as material_author,
           (select k.code from app.media_kinds k where k.id = ma.kind_id) as kind_code
      from app.media_assets ma left join app.materials m on m.asset_id = ma.id
     order by ma.created_at, ma.id
  loop
    caption := coalesce(nullif(btrim(fa.caption_ru), ''), 'Изображение');
    insert into app.entities (slug, title_ru, type_id, created_by, created_at)
    values (app.unique_slug('izobrazhenie ' || caption), caption, t_image,
            coalesce(fa.created_by, fa.material_author, su), fa.created_at)
    returning id into new_id;
    update app.media_assets set entity_id = new_id where id = fa.id;

    insert into app.indicators (entity_id, title, is_current, sort_order)
    values (new_id, 'Сведения', true, 0) returning id into ind;
    insert into app.indicator_values (indicator_id, parameter_id, text_value, sort_order)
    select ind, p.id, btrim(x.val), 0 from app.parameters p
      join (values ('image_author', fa.author), ('rights_holder', fa.credit),
                   ('image_source_url', fa.source_url), ('source_caption', fa.original_caption),
                   ('holder', fa.holder), ('inventory_no', fa.inventory_no),
                   ('license', concat_ws(' ', nullif(fa.license_code, ''), nullif(fa.license_url, ''))),
                   ('alt_text', fa.alt_text),
                   ('image_description', concat_ws(' ', nullif(fa.description, ''), nullif(fa.created_note, ''))))
           as x(code, val) on x.code = p.code
     where nullif(btrim(x.val), '') is not null;
    if fa.created_year is not null then
      insert into app.indicator_values (indicator_id, parameter_id, num_value, sort_order)
      select ind, id, fa.created_year, 0 from app.parameters where code = 'created_year';
    end if;
    if fa.kind_code is not null then
      insert into app.indicator_values (indicator_id, parameter_id, option_id, sort_order)
      select ind, p.id, o.id, 0 from app.parameters p
        join app.parameter_options o on o.parameter_id = p.id and o.code = fa.kind_code
       where p.code = 'image_kind';
    end if;

    insert into app.entity_tags (entity_id, tag_id)
    select new_id, mt.tag_id from app.media_tags mt where mt.asset_id = fa.id
    on conflict do nothing;

    insert into app.materials (kind, entity_id, created_by)
    values ('entity', new_id, coalesce(fa.material_author, fa.created_by, su)) returning id into mat;
    insert into app.material_credits (material_id, contributor_id, credit_role)
    select mat, mc.contributor_id, mc.credit_role
      from app.material_credits mc join app.materials m on m.id = mc.material_id
     where m.asset_id = fa.id;
    if not exists (select 1 from app.material_credits where material_id = mat) then
      insert into app.material_credits (material_id, contributor_id, credit_role)
      values (mat, coalesce(fa.material_author, fa.created_by, su), 'author');
    end if;
    insert into app.revisions (material_id, edited_by, operation, summary, snapshot)
    values (mat, coalesce(fa.material_author, fa.created_by, su), 'create', 'Р-84: файл стал записью', '{}'::jsonb);

    -- Публичен файл был, когда опубликован и открыт; теперь это публикация записи.
    if fa.material_status = 'published' and fa.visibility = 'public' then
      update app.entities set status = 'published', published_revision_id = working_revision_id where id = new_id;
    end if;
  end loop;

  -- 7.7. Присоединения изображений → связи «иллюстрация». Порядок — как был;
  -- обложка отмечена is_primary; подпись — обоснование этого использования.
  for att in
    select a.id, a.sort_order, t.entity_id as owner_id, ma.entity_id as image_id, ar.code as role,
           coalesce(nullif(btrim(a.note), ''), nullif(btrim(ma.caption_ru), ''), 'Иллюстрация') as caption,
           coalesce(a.created_by, su) as author
      from app.attachments a
      join app.targets t on t.id = a.target_id
      join app.attachment_roles ar on ar.id = a.role_id
      join app.media_assets ma on ma.id = a.asset_id
     where a.asset_id is not null and t.entity_id is not null
     order by t.entity_id, a.sort_order, a.id
  loop
    insert into app.links (from_entity_id, to_entity_id, role_id, sort_order, is_primary, created_by)
    values (att.owner_id, att.image_id, role_illustration, att.sort_order, att.role = 'cover', att.author)
    returning id into link_id;
    insert into app.materials (kind, link_id, created_by) values ('link', link_id, att.author) returning id into mat;
    insert into app.material_credits (material_id, contributor_id, credit_role) values (mat, att.author, 'author');
    insert into app.revisions (material_id, edited_by, operation, summary, snapshot)
    values (mat, att.author, 'create', 'Р-84: присоединение стало связью',
            jsonb_build_object('body_json', jsonb_build_array(jsonb_build_object(
              'id', 'caption', 'type', 'paragraph',
              'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', att.caption, 'styles', '{}'::jsonb))))));
    update app.links set status = 'published', published_revision_id = working_revision_id where id = link_id;
  end loop;

  -- 7.8. Текст записей → значение параметра «Текст». Сохранённые версии не
  -- переписываются: их текст читается из снимка как прежде.
  for ent in
    select e.id, r.snapshot->'body_json' as body
      from app.entities e join app.revisions r on r.id = e.working_revision_id
     where jsonb_typeof(r.snapshot->'body_json') = 'array'
       and jsonb_array_length(r.snapshot->'body_json') > 0
       and not exists (select 1 from app.indicators i join app.indicator_values v on v.indicator_id = i.id
                        join app.parameters p on p.id = v.parameter_id
                        where i.entity_id = e.id and p.code = 'text')
  loop
    insert into app.indicators (entity_id, title, is_current, sort_order)
    values (ent.id, 'Текст', true, 1000) returning id into ind;
    insert into app.indicator_values (indicator_id, parameter_id, blocks_value, sort_order)
    select ind, id, ent.body, 0 from app.parameters where code = 'text';
  end loop;
end $$;

-- ── 8. Чтение версий: прежние снимки со ссылкой на справочник мест ──────────

-- Старые снимки хранят place_id. Справочника больше нет, поэтому значение
-- находит запись-место по legacy_place_id; новые снимки несут entity_value_id.
create or replace function app.read_values(p_drafts boolean) returns setof app.indicator_values
language sql stable as $$
 select (jsonb_populate_record(null::app.indicator_values,
           v || case when v ? 'place_id' and not v ? 'entity_value_id'
                     then jsonb_build_object('entity_value_id',
                            (select x.id from app.entities x where x.legacy_place_id = (v->>'place_id')::uuid))
                     else '{}'::jsonb end)).*
   from app.entities e
   join app.revisions r on r.id = case when p_drafts then e.working_revision_id else e.published_revision_id end
   cross join lateral jsonb_array_elements(r.snapshot->'values') v
  where p_drafts or e.status = 'published';
$$;

-- ── 9. Снятие прежнего ───────────────────────────────────────────────────────

-- Отложенные проверки обоснований у только что созданных связей выполняем
-- сейчас: иначе Postgres не даст менять таблицы с ожидающими событиями.
set constraints all immediate;

-- Упоминания: все тексты теперь принадлежат записям.
create or replace view app.published_entity_mentions as
 select refs.entity_id, m.id as material_id, coalesce(e.legacy_description_id, -e.id) as document_id,
        r.snapshot->'entity'->>'title_ru' as document_title, refs.display_mode, refs.ordinal,
        e.id as owner_entity_id
   from app.entities e
   join app.revisions r on r.id = e.published_revision_id
   join app.materials m on m.entity_id = e.id
   join app.document_entity_refs refs on refs.revision_id = r.id
  where e.status = 'published';

-- Обоснование проверяется только у связи: присоединений больше нет.
create or replace function app.tg_link_requires_justification() returns trigger language plpgsql as $$
begin
 if not exists (select 1 from app.links where id = new.id) then return null; end if;
 if not exists (select 1 from app.links l join app.revisions r on r.id = l.working_revision_id
                 where l.id = new.id and jsonb_typeof(r.snapshot->'body_json') = 'array'
                   and jsonb_array_length(r.snapshot->'body_json') > 0) then
   raise exception 'Связь % не имеет обоснования', new.id using errcode = 'integrity_constraint_violation';
 end if;
 return null;
end $$;

drop trigger entities_targets_trg on app.entities;
drop trigger links_targets_trg on app.links;
drop function app.tg_targets_for_entity();
drop function app.tg_targets_for_link();

drop trigger materials_sync_published_trg on app.materials;
drop function app.tg_sync_published();
drop function if exists app.media_needs_attribution(app.media_assets);

alter table app.materials drop constraint materials_one_content_chk;
alter table app.materials drop constraint materials_kind_check;
alter table app.materials drop column attachment_id, drop column reference_item_id;
alter table app.materials
  add constraint materials_kind_check check (kind in ('entity', 'link', 'document', 'asset')),
  add constraint materials_one_content_chk check (num_nonnulls(entity_id, link_id, document_id, asset_id) = 1);

alter table app.indicators drop column source_reference_item_id;
alter table app.indicator_values drop column place_id;

drop table app.attachments;
drop table app.targets;
drop table app.attachment_roles;
drop table app.reference_items;
drop table app.reference_kinds;
drop table app.media_tags;
drop table app.places;

-- Реестр файла: только то, что относится к самому файлу.
alter table app.media_assets
  drop column kind_id, drop column caption_ru, drop column alt_text, drop column credit,
  drop column source_url, drop column license_code, drop column license_url,
  drop column visibility, drop column is_published, drop column description,
  drop column author, drop column created_year, drop column created_note,
  drop column holder, drop column inventory_no, drop column original_caption;
drop table app.media_kinds;

comment on table app.media_assets is
  'Техническое хранилище файла: варианты — в media_files, сведения и публикация — у записи entity_id (Р-84).';

-- ── 10. Новые ограничения ────────────────────────────────────────────────────

alter table app.parameters add constraint parameters_value_type_check
  check (value_type in ('number', 'integer', 'text', 'boolean', 'option', 'date', 'entity', 'blocks'));
alter table app.indicator_values add constraint indicator_values_one_value_chk
  check (num_nonnulls(num_value, text_value, bool_value, option_id, date_start_year,
                      entity_value_id, blocks_value) = 1);

-- Ссылки на файл в тексте (блок mediaImage) по-прежнему идут по UID файла.
-- Ждут ли изображения автора и источника (Р-68) — теперь по сведениям записи.
create function app.image_needs_attribution(p_entity bigint) returns boolean language sql stable as $$
  select not (
    exists (select 1 from app.indicator_values v join app.indicators i on i.id = v.indicator_id
              join app.parameters p on p.id = v.parameter_id
             where i.entity_id = p_entity and p.code in ('image_author', 'rights_holder'))
    and exists (select 1 from app.indicator_values v join app.indicators i on i.id = v.indicator_id
                  join app.parameters p on p.id = v.parameter_id
                 where i.entity_id = p_entity and p.code in ('image_source_url', 'source_caption', 'holder')))
$$;

-- Сведения места одним объектом — для редактора и карточки. Читаются из
-- выбранной редакции записи-места: гость видит опубликованное, редактор —
-- рабочее. Подпись не хранится, а собирается: иначе это второй источник.
create function app.place_json(p_entity bigint, p_drafts boolean) returns jsonb
language sql stable as $$
  select jsonb_build_object(
           'id', e.id::text, 'entity_id', e.id, 'slug', e.slug, 'title', e.title_ru,
           'country',    max(case when p.code = 'country' then v->>'text_value' end),
           'settlement', max(case when p.code = 'settlement' then v->>'text_value' end),
           'street',     max(case when p.code = 'street' then v->>'text_value' end),
           'house',      max(case when p.code = 'house' then v->>'text_value' end),
           'unit',       max(case when p.code = 'unit' then v->>'text_value' end),
           'lat',        max(case when p.code = 'latitude' then (v->>'num_value')::numeric end),
           'lon',        max(case when p.code = 'longitude' then (v->>'num_value')::numeric end),
           'precision',  coalesce(max(case when p.code = 'coord_precision'
                                            then (select o.code from app.parameter_options o
                                                   where o.id = (v->>'option_id')::uuid) end), 'building'),
           'source_url', max(case when p.code = 'info_source_url' then v->>'text_value' end))
    from app.entities e
    join app.revisions r on r.id = case when p_drafts then e.working_revision_id else e.published_revision_id end
    left join lateral jsonb_array_elements(r.snapshot->'values') v on true
    left join app.parameters p on p.id = (v->>'parameter_id')::uuid
   where e.id = p_entity
   group by e.id, e.slug, e.title_ru
$$;

-- Сведения изображения одним объектом — в том виде, что знает медиатека.
-- Читаются из выбранной редакции записи-изображения, как и у места.
create function app.image_json(p_entity bigint, p_drafts boolean) returns jsonb
language sql stable as $$
  select jsonb_build_object(
           'entity_id', e.id, 'slug', e.slug, 'title', r.snapshot->'entity'->>'title_ru',
           'is_published', e.status = 'published',
           'kind',             max(case when p.code = 'image_kind'
                                         then (select o.code from app.parameter_options o
                                                where o.id = (v->>'option_id')::uuid) end),
           'author',           max(case when p.code = 'image_author' then v->>'text_value' end),
           'credit',           max(case when p.code = 'rights_holder' then v->>'text_value' end),
           'source_url',       max(case when p.code = 'image_source_url' then v->>'text_value' end),
           'original_caption', max(case when p.code = 'source_caption' then v->>'text_value' end),
           'holder',           max(case when p.code = 'holder' then v->>'text_value' end),
           'inventory_no',     max(case when p.code = 'inventory_no' then v->>'text_value' end),
           'created_year',     max(case when p.code = 'created_year' then (v->>'num_value')::numeric end),
           'license_code',     max(case when p.code = 'license' then v->>'text_value' end),
           'alt_text',         max(case when p.code = 'alt_text' then v->>'text_value' end),
           'description',      max(case when p.code = 'image_description' then v->>'text_value' end))
    from app.entities e
    join app.revisions r on r.id = case when p_drafts then e.working_revision_id else e.published_revision_id end
    left join lateral jsonb_array_elements(r.snapshot->'values') v on true
    left join app.parameters p on p.id = (v->>'parameter_id')::uuid
   where e.id = p_entity
   group by e.id, e.slug, e.status, r.snapshot
$$;

-- Иллюстрации записи — связи «иллюстрация» к записям-изображениям (Р-84).
-- Гостю — только опубликованные связь и изображение: иначе карточка обещала
-- бы картинку, которой не отдают (Р-68). Порядок — порядок связей; меняя его,
-- редактор сразу публикует новую редакцию связи, поэтому рабочие поля связи
-- здесь и есть показываемые.
create function app.illustrations_json(p_entity bigint, p_drafts boolean) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'attachment_id', l.id, 'link_id', l.id, 'asset_id', a.id,
           'entity_id', img.id, 'slug', img.slug, 'is_primary', l.is_primary,
           'role', case when l.is_primary then 'cover' else 'gallery' end,
           'role_title', case when l.is_primary then 'Обложка' else 'Иллюстрация' end,
           'caption', x.info->>'title', 'kind', x.info->>'kind',
           'author', coalesce(x.info->>'author', x.info->>'credit'),
           'source_url', x.info->>'source_url',
           'source', coalesce(x.info->>'original_caption', x.info->>'holder'),
           'sort_order', l.sort_order)
           order by l.sort_order, l.id), '[]'::jsonb)
    from app.links l
    join app.link_roles r on r.id = l.role_id and r.code = 'illustration'
    join app.entities img on img.id = l.to_entity_id
    join app.media_assets a on a.entity_id = img.id and a.archived_at is null
    cross join lateral (select app.image_json(img.id, p_drafts) as info) x
   where l.from_entity_id = p_entity
     and case when p_drafts then l.status <> 'archived' else l.status = 'published' end
     and case when p_drafts then img.status <> 'archived' else img.status = 'published' end
$$;

-- Обложка — первая по порядку иллюстрация (Р-36), которую спрашивающий видит.
create function app.cover_asset(p_entity bigint, p_drafts boolean) returns uuid
language sql stable as $$
  select a.id
    from app.links l
    join app.link_roles r on r.id = l.role_id and r.code = 'illustration'
    join app.entities img on img.id = l.to_entity_id
    join app.media_assets a on a.entity_id = img.id and a.archived_at is null
   where l.from_entity_id = p_entity
     and case when p_drafts then l.status <> 'archived' else l.status = 'published' end
     and case when p_drafts then img.status <> 'archived' else img.status = 'published' end
   order by l.sort_order, l.id
   limit 1
$$;

-- Источники записи — связи «источник» с книгами, статьями, веб-страницами
-- (Р-80). Адрес — сведение источника, обстоятельства цитаты — обоснование.
-- Направление связи не важно: источником считается тот конец, что сам
-- источник по типу. Так на странице книги лекция не числится её источником.
create function app.sources_json(p_entity bigint, p_drafts boolean) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', src.id, 'entity_id', src.id, 'slug', src.slug, 'link_id', l.id,
           'kind', t.code, 'kind_title', t.title_ru, 'title', src.title_ru,
           'url', (select v->>'text_value'
                     from app.revisions sr, jsonb_array_elements(sr.snapshot->'values') v
                     join app.parameters p on p.id = (v->>'parameter_id')::uuid
                    where sr.id = case when p_drafts then src.working_revision_id else src.published_revision_id end
                      and p.code in ('url', 'wiki_url') limit 1),
           'year', (select (v->>'date_start_year')::int
                      from app.revisions sr, jsonb_array_elements(sr.snapshot->'values') v
                      join app.parameters p on p.id = (v->>'parameter_id')::uuid
                     where sr.id = case when p_drafts then src.working_revision_id else src.published_revision_id end
                       and p.code = 'publication' limit 1),
           'text', (select string_agg(b->'content'->0->>'text', ' ')
                      from app.revisions lr, jsonb_array_elements(lr.snapshot->'body_json') b
                     where lr.id = case when p_drafts then l.working_revision_id else l.published_revision_id end))
           order by l.sort_order, l.id), '[]'::jsonb)
    from app.links l
    join app.link_roles r on r.id = l.role_id and r.code = 'source'
    join app.entities src on src.id = case when l.from_entity_id = p_entity
                                           then l.to_entity_id else l.from_entity_id end
    join app.entity_types t on t.id = src.type_id
   where (l.from_entity_id = p_entity or l.to_entity_id = p_entity)
     and t.code in ('web_page', 'book', 'article')
     and case when p_drafts then l.status <> 'archived' else l.status = 'published' end
     and case when p_drafts then src.status <> 'archived' else src.status = 'published' end
$$;

-- Компоненты компактного вида типа: ближайшая настройка вверх по дереву.
-- По ним запись рисуется в строке текста и в списке.
create function app.compact_components(p_type uuid) returns text[] language sql stable as $$
  with recursive up as (
      select t.id, t.parent_id, 0 as distance from app.entity_types t where t.id = p_type
      union all
      select p.id, p.parent_id, up.distance + 1 from up join app.entity_types p on p.id = up.parent_id)
  select coalesce(array_agg(i.component order by i.sort_order), '{}')
    from app.type_presentation_items i
   where i.presentation_id = (select tp.id from up join app.type_presentations tp
                                on tp.type_id = up.id and tp.mode = 'compact'
                              order by up.distance limit 1)
$$;

-- Имя вида ответа для API. Ответ-запись из ветви «Где» клиент знает как
-- «место» — так он и называется в интерфейсе; в базе это ответ-запись.
create function app.api_value_type(p_parameter uuid) returns text language sql stable as $$
  select case when p.value_type = 'entity'
               and p.value_entity_type_id = (select id from app.entity_types where code = 'place')
              then 'place' else p.value_type end
    from app.parameters p where p.id = p_parameter
$$;

grant select, insert, update, delete on app.type_presentations, app.type_presentation_items to app_api;
grant execute on function app.slugify(text), app.unique_slug(text), app.image_needs_attribution(bigint),
  app.place_json(bigint, boolean), app.image_json(bigint, boolean), app.api_value_type(uuid),
  app.illustrations_json(bigint, boolean), app.cover_asset(bigint, boolean), app.sources_json(bigint, boolean),
  app.compact_components(uuid),
  app.read_values(boolean), app.entity_snapshot(bigint, jsonb) to app_api;

