-- 0016: параметры, наборы, показатели и значения (решение Р-38).
--
-- Предметные величины перестают быть колонками под класс вещей. Параметр —
-- определение величины, набор — список параметров для узла дерева типов,
-- показатели — прикрепление к записи с источником и датой, значение —
-- параметр и его величина.
--
-- Состав верхних наборов взят из прежней структуры данных: `public.projects`,
-- `public.authors`, `public.phenomena`, `public.styles`. Ничего нового здесь
-- не придумано — прежние колонки разложены по параметрам (правило 14).

-- 1. Справочник параметров
create table app.parameters (
    id         uuid primary key default gen_random_uuid(),
    code       text not null unique,
    title_ru   text not null,
    unit       text,
    value_type text not null check (value_type in
                   ('number', 'integer', 'text', 'boolean', 'option', 'date')),
    definition text,
    sort_order integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    created_by uuid references app.contributors(id),
    updated_by uuid references app.contributors(id)
);

comment on table app.parameters is
    'Определение величины: один смысл — один параметр, единица измерения часть определения.';
comment on column app.parameters.definition is
    'Что именно считается этой величиной. Для учебного сравнения важнее самого числа.';

create trigger parameters_audit_trg before insert or update on app.parameters
    for each row execute function app.tg_set_audit();

create table app.parameter_options (
    id           uuid primary key default gen_random_uuid(),
    parameter_id uuid not null references app.parameters(id) on delete cascade,
    code         text not null,
    title_ru     text not null,
    sort_order   integer not null default 0,
    unique (parameter_id, code)
);

comment on table app.parameter_options is
    'Допустимые значения параметра с типом «выбор».';

-- 2. Наборы: список параметров для узла дерева
create table app.parameter_sets (
    id         uuid primary key default gen_random_uuid(),
    code       text not null unique,
    title_ru   text not null,
    note       text,
    sort_order integer not null default 0
);

create table app.parameter_set_items (
    set_id       uuid not null references app.parameter_sets(id) on delete cascade,
    parameter_id uuid not null references app.parameters(id) on delete restrict,
    sort_order   integer not null default 0,
    hint         text,
    primary key (set_id, parameter_id)
);

create table app.type_parameter_sets (
    type_id uuid not null references app.entity_types(id) on delete cascade,
    set_id  uuid not null references app.parameter_sets(id) on delete cascade,
    primary key (type_id, set_id)
);

comment on table app.type_parameter_sets is
    'Набор действует для узла и всего, что ниже: общее не дублируется в ветвях.';

create table app.entity_parameter_sets (
    entity_id bigint not null references app.entities(id) on delete cascade,
    set_id    uuid not null references app.parameter_sets(id) on delete cascade,
    primary key (entity_id, set_id)
);

comment on table app.entity_parameter_sets is
    'Исключение для одной записи: музей в бывшем вокзале получает набор «Вокзал» вдобавок.';

-- 3. Показатели записи и значения
create table app.indicators (
    id                       uuid primary key default gen_random_uuid(),
    entity_id                bigint not null references app.entities(id) on delete cascade,
    title                    text not null,
    is_current               boolean not null default true,
    measured_year            integer,
    measured_by              text,
    source_reference_item_id bigint references app.reference_items(id),
    note                     text,
    sort_order               integer not null default 0,
    created_at               timestamptz not null default now(),
    updated_at               timestamptz not null default now(),
    created_by               uuid references app.contributors(id),
    updated_by               uuid references app.contributors(id)
);

comment on table app.indicators is
    'Одно измерение целиком: «по проекту», «после реконструкции». Правка входит в материал записи.';
comment on column app.indicators.is_current is
    'По действующим показателям считаются отбор и сортировка; в карточке видны все.';

create index indicators_entity_idx on app.indicators (entity_id);

create trigger indicators_audit_trg before insert or update on app.indicators
    for each row execute function app.tg_set_audit();

create table app.indicator_values (
    id               uuid primary key default gen_random_uuid(),
    indicator_id     uuid not null references app.indicators(id) on delete cascade,
    parameter_id     uuid not null references app.parameters(id) on delete restrict,
    num_value        numeric,
    text_value       text,
    bool_value       boolean,
    option_id        uuid references app.parameter_options(id),
    date_start_year  integer,
    date_start_month smallint check (date_start_month between 1 and 12),
    date_start_day   smallint check (date_start_day between 1 and 31),
    date_end_year    integer,
    date_end_month   smallint check (date_end_month between 1 and 12),
    date_end_day     smallint check (date_end_day between 1 and 31),
    is_approximate   boolean not null default false,
    is_ongoing       boolean not null default false,
    note             text,
    unique (indicator_id, parameter_id),
    constraint indicator_values_one_value_chk check (
        num_nonnulls(num_value, text_value, bool_value, option_id, date_start_year) = 1),
    constraint indicator_values_dates_order_chk check (
        date_end_year is null or date_start_year is null or date_end_year >= date_start_year),
    constraint indicator_values_ongoing_chk check (not (is_ongoing and date_end_year is not null))
);

-- Отбор и сортировка по числу: указатель по паре «параметр + значение».
create index indicator_values_number_idx on app.indicator_values (parameter_id, num_value)
    where num_value is not null;
create index indicator_values_parameter_idx on app.indicator_values (parameter_id);

-- Значение соответствует типу параметра: проверка в базе, а не по договорённости.
create or replace function app.tg_indicator_value_matches_type() returns trigger
language plpgsql as $$
declare
    vt text;
begin
    select value_type into vt from app.parameters where id = new.parameter_id;
    if vt is null then
        raise exception 'Неизвестный параметр' using errcode = 'foreign_key_violation';
    end if;

    if vt in ('number', 'integer') and new.num_value is null then
        raise exception 'Параметру нужен числовой ответ' using errcode = 'check_violation';
    end if;
    if vt = 'integer' and new.num_value <> trunc(new.num_value) then
        raise exception 'Параметр считается целым числом' using errcode = 'check_violation';
    end if;
    if vt = 'text' and new.text_value is null then
        raise exception 'Параметру нужен текстовый ответ' using errcode = 'check_violation';
    end if;
    if vt = 'boolean' and new.bool_value is null then
        raise exception 'Параметру нужен ответ да или нет' using errcode = 'check_violation';
    end if;
    if vt = 'option' then
        if new.option_id is null then
            raise exception 'Параметру нужно значение из списка' using errcode = 'check_violation';
        end if;
        if not exists (select 1 from app.parameter_options o
                        where o.id = new.option_id and o.parameter_id = new.parameter_id) then
            raise exception 'Значение из списка другого параметра'
                using errcode = 'check_violation';
        end if;
    end if;
    if vt = 'date' and new.date_start_year is null then
        raise exception 'Параметру нужна дата' using errcode = 'check_violation';
    end if;
    return new;
end;
$$;

create trigger indicator_values_type_trg
    before insert or update on app.indicator_values
    for each row execute function app.tg_indicator_value_matches_type();

-- 4. Что подсказывать при заполнении: наборы узла и всех его предков плюс
--    наборы самой записи. Наследование вниз по дереву — правило Р-38.
create or replace function app.entity_type_ancestors(p_type uuid) returns setof uuid
language sql stable as $$
    with recursive up as (
        select ty.id, ty.parent_id from app.entity_types ty where ty.id = p_type
        union all
        select p.id, p.parent_id from app.entity_types p join up on p.id = up.parent_id)
    select id from up;
$$;

create or replace function app.entity_parameters(p_entity bigint)
returns table (
    parameter_id uuid,
    code         text,
    title_ru     text,
    unit         text,
    value_type   text,
    definition   text,
    set_code     text,
    set_title    text,
    hint         text,
    sort_order   integer)
language sql stable as $$
    select distinct on (p.id)
           p.id, p.code, p.title_ru, p.unit, p.value_type, p.definition,
           ps.code, ps.title_ru, i.hint, i.sort_order
      from app.entities e
      join app.parameter_sets ps on ps.id in (
            select tps.set_id from app.type_parameter_sets tps
             where tps.type_id in (select app.entity_type_ancestors(e.type_id))
            union
            select eps.set_id from app.entity_parameter_sets eps where eps.entity_id = e.id)
      join app.parameter_set_items i on i.set_id = ps.id
      join app.parameters p on p.id = i.parameter_id
     where e.id = p_entity
     order by p.id, ps.sort_order, i.sort_order;
$$;

comment on function app.entity_parameters(bigint) is
    'Параметры, подсказанные записи её ветвью дерева и собственными наборами.';

-- 5. Верхние наборы из прежней структуры данных
insert into app.parameters (code, title_ru, value_type, definition, sort_order) values
    ('typology', 'Типология', 'text',
     'Назначение одним словом: театр, жилой дом, павильон. Прежнее projects.typology', 10),
    ('summary', 'Краткое описание', 'text',
     'Одно-два предложения для списка и подписи. Прежнее projects.description_short', 20),
    ('wiki_url', 'Ссылка на Википедию', 'text',
     'Статья о записи во внешней энциклопедии. Прежние projects.wiki_url и authors.wiki_url', 30),
    ('slogan', 'Девиз', 'text', 'Девиз по-русски. Прежнее projects.slogan_ru', 40),
    ('slogan_original', 'Девиз на языке оригинала', 'text',
     'Прежнее projects.slogan_original', 50),
    ('slogan_language', 'Язык девиза', 'text', 'Прежнее projects.slogan_language', 60),
    ('slogan_source_url', 'Источник девиза', 'text', 'Прежнее projects.slogan_source_url', 70),
    ('full_name', 'Полное имя', 'text',
     'Имя целиком, как в документах. Прежнее authors.full_name', 80),
    ('bio_short', 'Краткая справка', 'text',
     'Несколько строк о человеке или организации. Прежнее authors.bio_short', 90),
    ('website_url', 'Сайт', 'text', 'Собственный сайт. Прежнее authors.website_url', 100),
    ('short_definition', 'Краткое определение', 'text',
     'Одна фраза, что это за явление. Прежние phenomena.short_definition и styles.one_liner', 110);

insert into app.parameter_sets (code, title_ru, note, sort_order) values
    ('who_basic', 'Кто — основные сведения',
     'Состав взят из прежней таблицы authors', 10),
    ('what_basic', 'Что — основные сведения',
     'Состав взят из прежней таблицы projects', 20),
    ('when_basic', 'Когда — основные сведения',
     'Состав взят из прежних таблиц phenomena и styles', 30);

insert into app.parameter_set_items (set_id, parameter_id, sort_order)
select s.id, p.id, x.sort_order
  from (values
        ('who_basic',  'full_name',         10),
        ('who_basic',  'bio_short',         20),
        ('who_basic',  'wiki_url',          30),
        ('who_basic',  'website_url',       40),
        ('what_basic', 'typology',          10),
        ('what_basic', 'summary',           20),
        ('what_basic', 'wiki_url',          30),
        ('what_basic', 'slogan',            40),
        ('what_basic', 'slogan_original',   50),
        ('what_basic', 'slogan_language',   60),
        ('what_basic', 'slogan_source_url', 70),
        ('when_basic', 'short_definition',  10),
        ('when_basic', 'wiki_url',          20)
       ) as x(set_code, param_code, sort_order)
  join app.parameter_sets s on s.code = x.set_code
  join app.parameters p on p.code = x.param_code;

insert into app.type_parameter_sets (type_id, set_id)
select ty.id, s.id
  from (values ('who', 'who_basic'), ('what', 'what_basic'), ('when', 'when_basic'))
       as x(type_code, set_code)
  join app.entity_types ty on ty.code = x.type_code
  join app.parameter_sets s on s.code = x.set_code;

-- 6. Типология переезжает из остатка профиля в значения
insert into app.indicators (entity_id, title, is_current, sort_order)
select op.entity_id, 'Сведения', true, 0
  from app.object_profile op
 where op.typology is not null;

insert into app.indicator_values (indicator_id, parameter_id, text_value)
select i.id, p.id, op.typology
  from app.object_profile op
  join app.indicators i on i.entity_id = op.entity_id
  join app.parameters p on p.code = 'typology'
 where op.typology is not null;

drop table app.object_profile;

grant select, insert, update, delete on
    app.parameters, app.parameter_options, app.parameter_sets, app.parameter_set_items,
    app.type_parameter_sets, app.entity_parameter_sets, app.indicators, app.indicator_values
    to app_api;
grant execute on function app.entity_type_ancestors(uuid) to app_api;
grant execute on function app.entity_parameters(bigint) to app_api;
