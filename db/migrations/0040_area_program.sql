-- Площадная программа: значение-таблица у параметра записи.
--
-- Решение пользователя 2026-10-14: детальные площадные программы проектов нужны
-- для работы и анализа; таблица в тексте — «слабо», россыпь параметров —
-- «развесисто». Выбран третий путь: новый вид значения «таблица». Колонки
-- таблицы — обычные параметры, перечисленные набором (parameters.row_set_id);
-- строка — ответы на них; сама таблица — одно значение в группе сведений и
-- версионируется вместе с записью. Загрузка — через API, редактор позже.
-- Агрегирование по разделам — в базе, чтобы сравнивать проекты.

-- ── 1. Вид значения «таблица» ───────────────────────────────────────────────

alter table app.parameters drop constraint parameters_value_type_check;
alter table app.parameters add constraint parameters_value_type_check
  check (value_type in ('number', 'integer', 'text', 'boolean', 'option', 'date', 'entity', 'blocks', 'table'));

alter table app.parameters add column row_set_id uuid references app.parameter_sets(id);
comment on column app.parameters.row_set_id is
  'Для вида «таблица»: набор параметров — колонки строки таблицы.';
alter table app.parameters add constraint parameters_table_row_set_chk
  check ((value_type = 'table') = (row_set_id is not null));

alter table app.indicator_values add column table_value jsonb;
comment on column app.indicator_values.table_value is
  'Строки таблицы: массив объектов {uuid параметра-колонки: значение}; вариант — uuid варианта.';
alter table app.indicator_values drop constraint indicator_values_one_value_chk;
alter table app.indicator_values add constraint indicator_values_one_value_chk
  check (num_nonnulls(num_value, text_value, bool_value, option_id, date_start_year,
                      entity_value_id, blocks_value, table_value) = 1);

-- ── 2. Проверка строк ───────────────────────────────────────────────────────

-- Каждая ячейка — ответ на параметр-колонку своего набора, своего вида:
-- число — числом, целое — целым, текст — строкой, вариант — вариантом этого
-- параметра. Те же правила, что у обычного значения, только по строкам.
create function app.check_table_rows(p_parameter uuid, p_rows jsonb) returns void
language plpgsql stable as $$
declare
    row_set uuid;
    r jsonb;
    cell record;
    col record;
    n int := 0;
begin
    select row_set_id into row_set from app.parameters where id = p_parameter;
    if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
        raise exception 'Таблице нужна хотя бы одна строка' using errcode = 'check_violation';
    end if;
    for r in select * from jsonb_array_elements(p_rows) loop
        n := n + 1;
        if jsonb_typeof(r) <> 'object' then
            raise exception 'Строка % таблицы — не объект', n using errcode = 'check_violation';
        end if;
        for cell in select key, value from jsonb_each(r) loop
            select p.id, p.code, p.title_ru, p.value_type into col
              from app.parameters p
              join app.parameter_set_items i on i.parameter_id = p.id and i.set_id = row_set
             where p.id::text = cell.key;
            if not found then
                raise exception 'Строка %: колонки % нет в наборе таблицы', n, cell.key
                    using errcode = 'check_violation';
            end if;
            if col.value_type in ('number', 'integer') and jsonb_typeof(cell.value) <> 'number' then
                raise exception 'Строка %: «%» — число', n, col.title_ru using errcode = 'check_violation';
            end if;
            if col.value_type = 'integer' and (cell.value::text)::numeric <> trunc((cell.value::text)::numeric) then
                raise exception 'Строка %: «%» — целое число', n, col.title_ru using errcode = 'check_violation';
            end if;
            if col.value_type = 'text' and jsonb_typeof(cell.value) <> 'string' then
                raise exception 'Строка %: «%» — текст', n, col.title_ru using errcode = 'check_violation';
            end if;
            if col.value_type = 'option' and not exists (
                select 1 from app.parameter_options o
                 where o.parameter_id = col.id and o.id::text = cell.value #>> '{}') then
                raise exception 'Строка %: «%» — значение не из списка', n, col.title_ru
                    using errcode = 'check_violation';
            end if;
            if col.value_type not in ('number', 'integer', 'text', 'option') then
                raise exception 'Колонка «%»: вид % в таблице не поддерживается', col.title_ru, col.value_type
                    using errcode = 'check_violation';
            end if;
        end loop;
    end loop;
end;
$$;

-- Проверка вида значения дополняется таблицей.
create or replace function app.tg_indicator_value_matches_type()
 returns trigger language plpgsql as $function$
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
    if parameter.value_type = 'table' then
        if new.table_value is null then
            raise exception 'Параметру нужна таблица' using errcode = 'check_violation';
        end if;
        perform app.check_table_rows(new.parameter_id, new.table_value);
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
$function$;

-- ── 3. Перевод строк: коды ↔ номера ─────────────────────────────────────────

-- Из вида API (ключи — коды параметров-колонок, вариант — код варианта) в вид
-- хранения (ключи — uuid, вариант — uuid). Незнакомая колонка или вариант —
-- ошибка с понятным текстом; пустые ячейки отбрасываются.
create function app.table_rows_from_codes(p_parameter uuid, p_rows jsonb) returns jsonb
language plpgsql stable as $$
declare
    row_set uuid;
    r jsonb;
    cell record;
    col record;
    out_row jsonb;
    result jsonb := '[]'::jsonb;
    opt uuid;
    n int := 0;
begin
    select row_set_id into row_set from app.parameters where id = p_parameter;
    if row_set is null then
        raise exception 'Параметр не табличный' using errcode = 'check_violation';
    end if;
    if jsonb_typeof(p_rows) <> 'array' then
        raise exception 'Строки таблицы — массив' using errcode = 'check_violation';
    end if;
    for r in select * from jsonb_array_elements(p_rows) loop
        n := n + 1;
        out_row := '{}'::jsonb;
        for cell in select key, value from jsonb_each(r) loop
            continue when cell.value is null or cell.value = 'null'::jsonb or cell.value = '""'::jsonb;
            select p.id, p.title_ru, p.value_type into col
              from app.parameters p
              join app.parameter_set_items i on i.parameter_id = p.id and i.set_id = row_set
             where p.code = cell.key;
            if not found then
                raise exception 'Строка %: колонки «%» нет в таблице', n, cell.key using errcode = 'check_violation';
            end if;
            if col.value_type = 'option' then
                select o.id into opt from app.parameter_options o
                 where o.parameter_id = col.id and o.code = cell.value #>> '{}';
                if opt is null then
                    raise exception 'Строка %: «%» — нет варианта «%»', n, col.title_ru, cell.value #>> '{}'
                        using errcode = 'check_violation';
                end if;
                out_row := out_row || jsonb_build_object(col.id::text, opt::text);
            elsif col.value_type in ('number', 'integer') and jsonb_typeof(cell.value) = 'string' then
                out_row := out_row || jsonb_build_object(col.id::text, replace(cell.value #>> '{}', ',', '.')::numeric);
            else
                out_row := out_row || jsonb_build_object(col.id::text, cell.value);
            end if;
        end loop;
        if out_row <> '{}'::jsonb then
            result := result || jsonb_build_array(out_row);
        end if;
    end loop;
    return result;
end;
$$;

-- Из вида хранения в вид для чтения: ключи — коды колонок, у варианта —
-- код и название.
create function app.table_rows_json(p_parameter uuid, p_rows jsonb) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg((
           select coalesce(jsonb_object_agg(p.code,
                    case when p.value_type = 'option'
                         then (select jsonb_build_object('code', o.code, 'title', o.title_ru)
                                 from app.parameter_options o where o.id::text = c.value #>> '{}')
                         else c.value end), '{}'::jsonb)
             from jsonb_each(r.value) c
             join app.parameters p on p.id::text = c.key)
         order by r.ordinality), '[]'::jsonb)
    from jsonb_array_elements(p_rows) with ordinality r
   where p_rows is not null
$$;

-- Колонки таблицы по порядку набора: для заголовков и единиц.
create function app.table_columns(p_parameter uuid) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('code', p.code, 'title', p.title_ru,
                                               'unit', p.unit, 'value_type', p.value_type)
                            order by i.sort_order), '[]'::jsonb)
    from app.parameters t
    join app.parameter_set_items i on i.set_id = t.row_set_id
    join app.parameters p on p.id = i.parameter_id
   where t.id = p_parameter
$$;

-- Имя вида ответа для API — таблица остаётся таблицей.
-- (app.api_value_type уже отдаёт value_type как есть для всего, кроме места.)

-- ── 4. Площадная программа ──────────────────────────────────────────────────

insert into app.parameters (code, title_ru, value_type, unit, definition, sort_order) values
  ('program_section', 'Раздел', 'option', null,
   'Функциональный раздел программы: из общего списка — по нему сравниваются проекты.', 10),
  ('program_room', 'Помещение', 'text', null, 'Название помещения или группы помещений.', 20),
  ('program_area', 'Площадь', 'number', 'м²', 'Площадь одного помещения.', 30),
  ('program_count', 'Количество', 'integer', 'шт.', 'Сколько таких помещений.', 40),
  ('program_area_total', 'Площадь всего', 'number', 'м²',
   'Площадь всех таких помещений. Если не указана — площадь × количество.', 50),
  ('program_seats', 'Мест', 'integer', 'мест', 'Число мест или человек в помещении.', 60),
  ('program_level', 'Уровень', 'text', null, 'Этаж или уровень, например «+1», «−2».', 70),
  ('program_note', 'Примечание', 'text', null, 'Оговорки, источник строки.', 80);

-- Общий список разделов — для сравнения проектов между собой. Пополняется.
insert into app.parameter_options (parameter_id, code, title_ru, sort_order)
select p.id, x.code, x.title, x.sort
  from app.parameters p,
       (values ('entrance', 'Вестибюль и гардероб', 10), ('foyer', 'Фойе и рекреации', 20),
               ('hall', 'Зрительный зал', 30), ('stage', 'Сцена и сценическая коробка', 40),
               ('artists', 'Артистическая часть', 50), ('rehearsal', 'Репетиционные залы', 60),
               ('workshops', 'Мастерские и склады', 70), ('exhibition', 'Экспозиция', 80),
               ('education', 'Учебные помещения', 90), ('catering', 'Общественное питание', 100),
               ('admin', 'Административная часть', 110), ('technical', 'Технические помещения', 120),
               ('circulation', 'Коммуникации: лестницы, коридоры', 130), ('other', 'Прочее', 140))
       as x(code, title, sort)
 where p.code = 'program_section';

insert into app.parameter_sets (code, title_ru, note, sort_order) values
  ('program_row', 'Строка площадной программы',
   'Колонки площадной программы. Набор описывает таблицу и к записям не подключается.', 900),
  ('area_program', 'Площадная программа',
   'Детальная площадная программа проекта: таблица помещений по разделам. Подключается к записи по отдельности.', 140);

insert into app.parameter_set_items (set_id, parameter_id, sort_order)
select s.id, p.id, p.sort_order
  from app.parameter_sets s join app.parameters p
    on p.code in ('program_section', 'program_room', 'program_area', 'program_count',
                  'program_area_total', 'program_seats', 'program_level', 'program_note')
 where s.code = 'program_row';

insert into app.parameters (code, title_ru, value_type, unit, definition, sort_order, row_set_id)
select 'area_program', 'Площадная программа', 'table', null,
       'Помещения проекта по разделам: площадь, количество, места. Одна программа на группу сведений — на состояние проекта.',
       10, id
  from app.parameter_sets where code = 'program_row';

insert into app.parameter_set_items (set_id, parameter_id, sort_order)
select s.id, p.id, 10 from app.parameter_sets s, app.parameters p
 where s.code = 'area_program' and p.code = 'area_program';

-- ── 5. Итоги: основа анализа и сравнения ────────────────────────────────────

-- Площадь строки: «Площадь всего», иначе площадь × количество (без количества — 1).
create function app.program_row_area(p_row jsonb) returns numeric
language sql stable as $$
  select coalesce(
           (p_row ->> (select id::text from app.parameters where code = 'program_area_total'))::numeric,
           (p_row ->> (select id::text from app.parameters where code = 'program_area'))::numeric
             * coalesce((p_row ->> (select id::text from app.parameters where code = 'program_count'))::numeric, 1))
$$;

-- Итоги площадных программ записи: по группе сведений — общая площадь и
-- площади разделов с долей. Читается редакция, которую видит спрашивающий.
create function app.area_program_totals(p_entity bigint, p_drafts boolean) returns jsonb
language sql stable as $$
  with v as (
    select ind.i as indicator, val.v as value
      from app.entities e
      join app.revisions r on r.id = case when p_drafts then e.working_revision_id else e.published_revision_id end
      cross join lateral jsonb_array_elements(r.snapshot->'values') val(v)
      left join lateral (select i from jsonb_array_elements(r.snapshot->'indicators') i
                          where i->>'id' = val.v->>'indicator_id') ind on true
     where e.id = p_entity and (p_drafts or e.status = 'published')
       and (val.v->>'parameter_id')::uuid = (select id from app.parameters where code = 'area_program')
  ),
  rows as (
    select v.indicator, x.r,
           app.program_row_area(x.r) as area,
           x.r ->> (select id::text from app.parameters where code = 'program_section') as section_id
      from v cross join lateral jsonb_array_elements(v.value->'table_value') x(r)
  ),
  sections as (
    select indicator, section_id, sum(area) as area, count(*) as rows
      from rows group by indicator, section_id
  ),
  shared as (
    select s.*, sum(s.area) over (partition by s.indicator->>'id') as total from sections s
  )
  select coalesce(jsonb_agg(g order by (g->>'sort')::int), '[]'::jsonb) from (
    select jsonb_build_object(
             'indicator_id', s.indicator->>'id',
             'title', s.indicator->>'title',
             'sort', coalesce((s.indicator->>'sort_order')::int, 0),
             'total_area', max(s.total),
             'sections', jsonb_agg(jsonb_build_object(
                 'code', o.code, 'title', coalesce(o.title_ru, 'Без раздела'),
                 'area', s.area, 'rows', s.rows,
                 'share', round(s.area / nullif(s.total, 0), 4))
               order by o.sort_order nulls last)) as g
      from shared s
      left join app.parameter_options o on o.id::text = s.section_id
     group by s.indicator
  ) t
$$;

grant execute on function app.check_table_rows(uuid, jsonb), app.table_rows_from_codes(uuid, jsonb),
  app.table_rows_json(uuid, jsonb), app.table_columns(uuid), app.program_row_area(jsonb),
  app.area_program_totals(bigint, boolean) to app_api;
