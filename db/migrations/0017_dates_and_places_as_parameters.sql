-- 0017: датировки и места становятся параметрами (решения Р-38, Р-39).
--
-- У проекта три основы: запись, связь, параметр. Дата и место — не четвёртая
-- и не пятая сущность, а ответы на вопросы «когда» и «где», то есть величины.
-- Вид даты (проектирование, открытие) и роль места (адрес объекта, место
-- рождения) — это и есть параметры.
--
-- Справочник мест остаётся: для параметра с типом «место» он то же, чем
-- список значений служит параметру с типом «выбор» — общий набор возможных
-- ответов. Переиспользование и защита от повторов (Р-35) сохраняются.

-- 1. Величина может быть местом, а у вопроса бывает несколько ответов
alter table app.parameters
    add column is_repeatable boolean not null default false;

comment on column app.parameters.is_repeatable is
    'У вопроса бывает несколько ответов: две реконструкции, два адреса. У величин для сравнения — один.';

alter table app.parameters drop constraint parameters_value_type_check;
alter table app.parameters add constraint parameters_value_type_check
    check (value_type in ('number', 'integer', 'text', 'boolean', 'option', 'date', 'place'));

alter table app.indicator_values
    add column place_id uuid references app.places(id) on delete restrict,
    add column sort_order integer not null default 0;

alter table app.indicator_values drop constraint indicator_values_one_value_chk;
alter table app.indicator_values add constraint indicator_values_one_value_chk check (
    num_nonnulls(num_value, text_value, bool_value, option_id, date_start_year, place_id) = 1);

-- Повторы разрешает сам параметр, поэтому уникальность переезжает из
-- ограничения в проверку, которая умеет смотреть на его определение.
alter table app.indicator_values drop constraint indicator_values_indicator_id_parameter_id_key;
create index indicator_values_indicator_idx on app.indicator_values (indicator_id, parameter_id);
create index indicator_values_place_idx on app.indicator_values (place_id)
    where place_id is not null;

create or replace function app.tg_indicator_value_matches_type() returns trigger
language plpgsql as $$
declare
    parameter record;
begin
    select value_type, is_repeatable, title_ru into parameter
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
    if parameter.value_type = 'place' and new.place_id is null then
        raise exception 'Параметру нужно место' using errcode = 'check_violation';
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

-- 2. Виды дат становятся параметрами с теми же кодами и названиями
insert into app.parameters (code, title_ru, value_type, is_repeatable, definition, sort_order)
select k.code, k.title_ru, 'date', true,
       'Прежний вид даты из справочника date_kinds', 200 + k.sort_order
  from app.date_kinds k;

-- 3. Роли мест становятся параметрами с типом «место»
insert into app.parameters (code, title_ru, value_type, is_repeatable, definition, sort_order)
values
    ('address',    'Адрес объекта',     'place', true, 'Прежняя роль привязки места', 310),
    ('birthplace', 'Место рождения',    'place', true, 'Прежняя роль привязки места', 320),
    ('burial',     'Захоронение',       'place', true, 'Прежняя роль привязки места', 330),
    ('office',     'Офис организации',  'place', true, 'Прежняя роль привязки места', 340);

-- 4. Разносим по наборам верхних ветвей: даты людей и организаций — «Кто»,
--    даты объектов — «Что», границы периодов — «Когда».
insert into app.parameter_set_items (set_id, parameter_id, sort_order)
select s.id, p.id, 200 + p.sort_order
  from app.parameters p
  join app.date_kinds k on k.code = p.code
  join app.parameter_sets s
    on s.code = case k.applies_to
                  when 'person' then 'who_basic'
                  when 'object' then 'what_basic'
                  else 'when_basic' end
 where p.value_type = 'date';

insert into app.parameter_set_items (set_id, parameter_id, sort_order)
select s.id, p.id, 300 + p.sort_order
  from (values ('address', 'what_basic'), ('birthplace', 'who_basic'),
               ('burial', 'who_basic'), ('office', 'who_basic')) as x(code, set_code)
  join app.parameters p on p.code = x.code
  join app.parameter_sets s on s.code = x.set_code;

-- 5. Записям, у которых есть датировки или места, нужны показатели
insert into app.indicators (entity_id, title, is_current, sort_order)
select distinct e.id, 'Сведения', true, 0
  from app.entities e
 where not exists (select 1 from app.indicators i where i.entity_id = e.id)
   and (exists (select 1 from app.entity_dates d where d.entity_id = e.id)
        or exists (select 1 from app.attachments a
                   join app.targets t on t.id = a.target_id
                  where t.entity_id = e.id and a.place_id is not null));

-- 6. Датировки переезжают значениями
insert into app.indicator_values (
    indicator_id, parameter_id, date_start_year, date_start_month, date_start_day,
    date_end_year, date_end_month, date_end_day, is_approximate, is_ongoing, note, sort_order)
select i.id, p.id, d.start_year, d.start_month, d.start_day,
       d.end_year, d.end_month, d.end_day, d.is_approximate, d.is_ongoing, d.note, d.sort_order
  from app.entity_dates d
  join app.date_kinds k on k.id = d.kind_id
  join app.parameters p on p.code = k.code and p.value_type = 'date'
  join lateral (select id from app.indicators
                 where entity_id = d.entity_id order by sort_order, id limit 1) i on true;

-- 7. Места переезжают значениями; роль привязки становится параметром
insert into app.indicator_values (indicator_id, parameter_id, place_id, note, sort_order)
select i.id, p.id, a.place_id, a.note, a.sort_order
  from app.attachments a
  join app.targets t on t.id = a.target_id
  join app.attachment_roles ar on ar.id = a.role_id
  join app.parameters p on p.code = ar.code and p.value_type = 'place'
  join lateral (select id from app.indicators
                 where entity_id = t.entity_id order by sort_order, id limit 1) i on true
 where a.place_id is not null and t.entity_id is not null;

-- Места, прикреплённые к связям, параметрами пока не становятся: величины
-- у связи не заведены. Таких привязок нет, но молча терять их нельзя.
do $$
declare stray integer;
begin
    select count(*) into stray
      from app.attachments a join app.targets t on t.id = a.target_id
     where a.place_id is not null and t.link_id is not null;
    if stray > 0 then
        raise exception 'Место прикреплено к связи (% шт.): перенос не описан', stray;
    end if;
end;
$$;

delete from app.attachments where place_id is not null;

-- Отложенные проверки вложений срабатывают в конце транзакции, а таблицу
-- нельзя менять, пока они ждут своей очереди: просим выполнить их сейчас.
set constraints all immediate;

-- 8. Прежние хранилища убираем: два источника одного сведения недопустимы
alter table app.attachments drop constraint attachments_one_content_chk;
alter table app.attachments drop column place_id;
alter table app.attachments add constraint attachments_one_content_chk check (
    num_nonnulls(document_id, asset_id, reference_item_id) = 1);

delete from app.attachment_roles where code in ('address', 'birthplace', 'burial', 'office');

drop table app.entity_dates;
drop table app.date_kinds;

-- 9. Показ и отбор: где хранится место, знает справочник мест
comment on table app.places is
    'Справочник мест: общий набор ответов для параметров с типом «место». Повтор адреса невозможен (Р-35).';
