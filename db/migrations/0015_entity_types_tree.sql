-- 0015: единое дерево типов вместо видов и профилей (решение Р-37).
--
-- Вид записи перестаёт быть отдельным понятием: это верхняя ветвь дерева
-- типов. Человек, здание и стиль — записи одного устройства, различаются
-- типом и набором параметров, а не строением.
--
-- Что переносится: три словаря видов и три словаря типов сходятся в одно
-- дерево; у записи появляется обязательный тип; профили снимаются. Данных
-- двенадцать записей — момент для переноса самый дешёвый.
--
-- Что остаётся до следующих этапов: `object_profile` доживает с одной
-- колонкой `typology` (заполнена у девяти объектов) — на этапе Б она станет
-- значением параметра, и таблица уйдёт. `entity_dates` не трогаем: датировки
-- переезжают в параметры на этапе В.

-- 1. Дерево типов
create table app.entity_types (
    id         uuid primary key default gen_random_uuid(),
    parent_id  uuid references app.entity_types(id) on delete restrict,
    code       text not null unique,
    title_ru   text not null,
    sort_order integer not null default 0,
    constraint entity_types_not_self_parent_chk check (parent_id is distinct from id)
);

create index entity_types_parent_idx on app.entity_types (parent_id);

comment on table app.entity_types is
    'Дерево типов записей. Корневые ветви заменяют прежние виды, ниже растут типы.';
comment on column app.entity_types.parent_id is
    'Родительский узел; пусто только у корневой ветви.';

-- Узел не может оказаться собственным предком: иначе обход ветви зациклится.
create or replace function app.tg_entity_types_no_cycle() returns trigger
language plpgsql as $$
declare
    ancestor uuid := new.parent_id;
    hops     integer := 0;
begin
    while ancestor is not null loop
        if ancestor = new.id then
            raise exception 'Тип не может быть собственным предком'
                using errcode = 'check_violation';
        end if;
        select parent_id into ancestor from app.entity_types where id = ancestor;
        hops := hops + 1;
        if hops > 100 then
            raise exception 'Дерево типов зациклено' using errcode = 'check_violation';
        end if;
    end loop;
    return new;
end;
$$;

create trigger entity_types_no_cycle_trg
    before insert or update of parent_id on app.entity_types
    for each row execute function app.tg_entity_types_no_cycle();

-- 2. Корневые ветви. Идентификаторы прежних видов сохраняются: снимки версий
--    и ссылки на них остаются осмысленными.
insert into app.entity_types (id, parent_id, code, title_ru, sort_order) values
    ('00000000-0000-4000-a000-0000000000e1', null, 'who',  'Кто',   10),
    ('00000000-0000-4000-a000-0000000000e2', null, 'what', 'Что',   20),
    ('00000000-0000-4000-a000-0000000000e3', null, 'when', 'Когда', 30);

-- 3. Прежние словари типов становятся ветвями. Коды и названия сохраняются.
insert into app.entity_types (parent_id, code, title_ru, sort_order)
select '00000000-0000-4000-a000-0000000000e1', t.code, t.title_ru, t.sort_order
  from app.person_types t;

insert into app.entity_types (parent_id, code, title_ru, sort_order)
select '00000000-0000-4000-a000-0000000000e2', t.code, t.title_ru, t.sort_order
  from app.object_types t;

-- Периоды хранились двумя уровнями: тема и раздел. Дерево передаёт это прямо.
insert into app.entity_types (parent_id, code, title_ru, sort_order)
select distinct on (t.theme_code)
       '00000000-0000-4000-a000-0000000000e3', t.theme_code, t.theme_title_ru, t.sort_order
  from app.period_types t
 order by t.theme_code, t.sort_order;

insert into app.entity_types (parent_id, code, title_ru, sort_order)
select theme.id, t.theme_code || '_' || t.section_code, t.section_title_ru, t.sort_order
  from app.period_types t
  join app.entity_types theme on theme.code = t.theme_code;

-- 4. У записи появляется тип
alter table app.entities add column type_id uuid references app.entity_types(id);

update app.entities e
   set type_id = coalesce(
        (select ty.id from app.object_profile op
           join app.object_types ot on ot.id = op.object_type_id
           join app.entity_types ty on ty.code = ot.code
          where op.entity_id = e.id),
        (select ty.id from app.person_profile pp
           join app.person_types pt on pt.id = pp.person_type_id
           join app.entity_types ty on ty.code = pt.code
          where pp.entity_id = e.id),
        e.kind_id);

alter table app.entities alter column type_id set not null;
create index entities_type_idx on app.entities (type_id);

comment on column app.entities.type_id is
    'Тип записи — узел дерева любой глубины. Обязателен и один.';

-- 5. Профили снимаются. У участников и периодов своих сведений не осталось:
--    тип переехал в дерево, координаты живут местами (Р-25).
drop table app.person_profile;
drop table app.period_profile;

alter table app.object_profile
    drop constraint object_profile_entity_id_kind_id_fkey,
    drop column kind_id,
    drop column object_type_id,
    drop column lat,
    drop column lon;

comment on table app.object_profile is
    'Временное хранилище типологии до этапа Б: там она станет значением параметра.';

-- 6. Видов больше нет — значит, и уникальности «в пределах вида»
alter table app.entities
    drop constraint entities_id_kind_id_key,
    drop constraint entities_kind_id_slug_key,
    drop column kind_id,
    add constraint entities_slug_key unique (slug);

-- Обложка — первое прикреплённое изображение по порядку (Р-36), второго места
-- для того же сведения не держим. Колонка не заполнена ни у одной записи.
alter table app.entities drop column cover_media_id;

alter table app.slug_history
    drop constraint slug_history_pkey,
    drop column kind_id,
    add constraint slug_history_pkey primary key (slug);

-- 7. Прежние словари
drop table app.object_types;
drop table app.person_types;
drop table app.period_types;
drop table app.entity_kinds;

-- 8. Обход дерева: путь до корня для карточки и ветвь целиком для отбора.
create or replace function app.entity_type_path(p_type uuid) returns jsonb
language sql stable as $$
    with recursive up as (
        select ty.id, ty.parent_id, ty.code, ty.title_ru, 0 as depth
          from app.entity_types ty
         where ty.id = p_type
        union all
        select p.id, p.parent_id, p.code, p.title_ru, up.depth + 1
          from app.entity_types p
          join up on p.id = up.parent_id)
    select coalesce(
        jsonb_agg(jsonb_build_object('code', code, 'title', title_ru) order by depth desc),
        '[]'::jsonb)
      from up;
$$;

comment on function app.entity_type_path(uuid) is
    'Путь от корневой ветви до типа: [{code, title}] сверху вниз.';

create or replace function app.entity_type_subtree(p_code text) returns setof uuid
language sql stable as $$
    with recursive branch as (
        select ty.id from app.entity_types ty where ty.code = p_code
        union all
        select ch.id from app.entity_types ch join branch b on ch.parent_id = b.id)
    select id from branch;
$$;

comment on function app.entity_type_subtree(text) is
    'Ветвь целиком: узел и всё, что под ним. Отбор по виду и по типу — одно и то же.';

grant select, insert, update, delete on app.entity_types to app_api;
grant execute on function app.entity_type_path(uuid) to app_api;
grant execute on function app.entity_type_subtree(text) to app_api;
