-- Иерархия в списке вариантов параметра и классификатор помещений.
--
-- Решение пользователя 2026-10-14: классификатор помещений двухуровневый и
-- шире (зона → назначение, у инженерии — зона → раздел → помещение), и
-- реализуется деревом вариантов: у варианта есть родитель того же параметра.
-- Плоские списки — дерево без родителей, ничего в них не меняется. В строке
-- площадной программы выбирается один узел дерева; зона — его корень.
-- Формат строки — «Классификатор помещений» в WIKI.

-- ── 1. Дерево вариантов ─────────────────────────────────────────────────────

alter table app.parameter_options add column parent_id uuid references app.parameter_options(id);
comment on column app.parameter_options.parent_id is
  'Родительский вариант того же параметра: список вариантов — дерево (классификатор помещений).';

create function app.tg_option_parent() returns trigger language plpgsql as $$
begin
    if new.parent_id is null then return new; end if;
    if not exists (select 1 from app.parameter_options p
                    where p.id = new.parent_id and p.parameter_id = new.parameter_id) then
        raise exception 'Родитель варианта — вариант того же параметра' using errcode = 'check_violation';
    end if;
    if exists (with recursive up as (
                   select id, parent_id from app.parameter_options where id = new.parent_id
                   union all
                   select o.id, o.parent_id from app.parameter_options o join up on o.id = up.parent_id)
               select 1 from up where id = new.id) then
        raise exception 'Вариант не может быть своим предком' using errcode = 'check_violation';
    end if;
    return new;
end;
$$;
create trigger parameter_options_parent_trg before insert or update of parent_id on app.parameter_options
  for each row execute function app.tg_option_parent();

-- Вариант, которым ответили в таблице, не удаляется: ячейка хранит его номер.
create function app.tg_option_in_tables() returns trigger language plpgsql as $$
begin
    if exists (select 1 from app.indicator_values v
                where v.table_value is not null and v.table_value::text like '%' || old.id::text || '%') then
        raise exception 'Значение «%» уже выбрано в таблицах: убрать нельзя', old.title_ru
            using errcode = 'check_violation';
    end if;
    return old;
end;
$$;
create trigger parameter_options_in_tables_trg before delete on app.parameter_options
  for each row execute function app.tg_option_in_tables();

-- Путь варианта от корня: [{code, title}, …]. По нему — зона и уровни.
create function app.option_path(p_option uuid) returns jsonb
language sql stable as $$
  with recursive up as (
      select id, parent_id, code, title_ru, 0 as depth from app.parameter_options where id = p_option
      union all
      select o.id, o.parent_id, o.code, o.title_ru, up.depth + 1
        from app.parameter_options o join up on o.id = up.parent_id)
  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'title', title_ru) order by depth desc), '[]'::jsonb)
    from up
$$;

-- Ячейка-вариант в таблице для чтения — с путём от корня.
create or replace function app.table_rows_json(p_parameter uuid, p_rows jsonb) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg((
           select coalesce(jsonb_object_agg(p.code,
                    case when p.value_type = 'option'
                         then (select jsonb_build_object('code', o.code, 'title', o.title_ru,
                                                         'path', app.option_path(o.id))
                                 from app.parameter_options o where o.id::text = c.value #>> '{}')
                         else c.value end), '{}'::jsonb)
             from jsonb_each(r.value) c
             join app.parameters p on p.id::text = c.key)
         order by r.ordinality), '[]'::jsonb)
    from jsonb_array_elements(p_rows) with ordinality r
   where p_rows is not null
$$;

-- ── 2. Классификатор помещений ──────────────────────────────────────────────

insert into app.parameters (code, title_ru, value_type, unit, definition, sort_order) values
  ('program_purpose', 'Назначение', 'option', null,
   'Классификатор помещений: зона → назначение (у инженерии — зона → раздел → помещение). Можно выбрать и промежуточный узел, если источник не детальнее.', 10);

-- (код, название, код родителя, порядок)
create temporary table purpose_tree (code text, title text, parent text, sort int) on commit drop;
insert into purpose_tree values
  ('core', 'Место основной деятельности', null, 10),
    ('core.stage', 'Сцена, карманы, арьерсцена', 'core', 10),
    ('core.workplace', 'Рабочие места, open space', 'core', 20),
    ('core.classroom', 'Учебные классы, лаборатории', 'core', 30),
    ('core.sport', 'Спортивный зал, арена', 'core', 40),
    ('core.exhibition', 'Экспозиция', 'core', 50),
    ('core.living', 'Жилые комнаты', 'core', 60),
  ('users', 'Места пользователей', null, 20),
    ('users.auditorium', 'Зрительный зал, балконы', 'users', 10),
    ('users.meeting', 'Переговорные, залы собраний', 'users', 20),
    ('users.assembly', 'Актовый зал', 'users', 30),
    ('users.stands', 'Трибуны', 'users', 40),
  ('visitors', 'Пользователи вне основной зоны', null, 30),
    ('visitors.entrance', 'Вестибюль, кассы, ресепшен', 'visitors', 10),
    ('visitors.cloakroom', 'Гардероб', 'visitors', 20),
    ('visitors.foyer', 'Фойе, рекреации, холлы', 'visitors', 30),
    ('visitors.catering', 'Кафе, столовая, ресторан', 'visitors', 40),
    ('visitors.wc', 'Санузлы для посетителей', 'visitors', 50),
  ('performers', 'Исполнители / персонал основной деятельности', null, 40),
    ('performers.dressing', 'Гримёрные', 'performers', 10),
    ('performers.rehearsal', 'Репетиционные залы', 'performers', 20),
    ('performers.costume', 'Костюмерные, прачечные', 'performers', 30),
    ('performers.staffroom', 'Учительские, методкабинеты', 'performers', 40),
  ('production', 'Производство и склады', null, 50),
    ('production.workshops', 'Мастерские', 'production', 10),
    ('production.storage', 'Склады, кладовые', 'production', 20),
    ('production.kitchen', 'Кухни, пищеблок', 'production', 30),
    ('production.archive', 'Архив', 'production', 40),
    ('production.loading', 'Разгрузка, приёмка', 'production', 50),
  ('management', 'Управление и службы', null, 60),
    ('management.admin', 'Администрация, офисы', 'management', 10),
    ('management.security', 'Охрана, диспетчерская', 'management', 20),
    ('management.staff', 'Бытовые помещения персонала, клининг', 'management', 30),
    ('management.medical', 'Медпункт', 'management', 40),
    ('management.apartment', 'Прихожие и санузлы квартир', 'management', 50),
  ('other', 'Другие функции', null, 70),
    ('other.rent', 'Аренда, торговля', 'other', 10),
  ('circulation', 'Пути движения', null, 80),
    ('circulation.stairs', 'Лестницы', 'circulation', 10),
    ('circulation.lifts', 'Лифтовые холлы', 'circulation', 20),
    ('circulation.corridors', 'Коридоры, переходы', 'circulation', 30),
    ('circulation.common', 'Места общего пользования жилья', 'circulation', 40),
  ('engineering', 'Инженерные системы', null, 90),
    ('engineering.hvac', 'ОВ', 'engineering', 10),
      ('engineering.hvac.vent', 'Венткамера', 'engineering.hvac', 10),
      ('engineering.hvac.itp', 'ИТП', 'engineering.hvac', 20),
      ('engineering.hvac.boiler', 'Котельная', 'engineering.hvac', 30),
      ('engineering.hvac.chiller', 'Холодильная станция', 'engineering.hvac', 40),
      ('engineering.hvac.cooling', 'Градирни', 'engineering.hvac', 50),
    ('engineering.water', 'ВК', 'engineering', 20),
      ('engineering.water.pumps', 'Насосная', 'engineering.water', 10),
      ('engineering.water.meter', 'Водомерный узел', 'engineering.water', 20),
      ('engineering.water.tanks', 'Резервуары', 'engineering.water', 30),
    ('engineering.power', 'ЭС / ЭО', 'engineering', 30),
      ('engineering.power.substation', 'Трансформаторная', 'engineering.power', 10),
      ('engineering.power.switchboard', 'Электрощитовая', 'engineering.power', 20),
      ('engineering.power.generator', 'ДГУ', 'engineering.power', 30),
    ('engineering.lowcurrent', 'СС', 'engineering', 40),
      ('engineering.lowcurrent.server', 'Серверная', 'engineering.lowcurrent', 10),
      ('engineering.lowcurrent.cross', 'Кроссовая, слаботочная', 'engineering.lowcurrent', 20),
    ('engineering.fire', 'ПБ', 'engineering', 50),
      ('engineering.fire.pumps', 'Пожарная насосная', 'engineering.fire', 10),
      ('engineering.fire.suppression', 'Помещения АУПТ', 'engineering.fire', 20),
    ('engineering.tech', 'ТХ', 'engineering', 60),
      ('engineering.tech.stage', 'Сценическая механика', 'engineering.tech', 10),
      ('engineering.tech.flies', 'Колосники, рабочие галереи', 'engineering.tech', 20),
  ('parking', 'Парковка', null, 100),
    ('parking.cars', 'Автостоянка', 'parking', 10),
    ('parking.ramps', 'Рампы, проезды', 'parking', 20);

insert into app.parameter_options (parameter_id, code, title_ru, sort_order)
select (select id from app.parameters where code = 'program_purpose'), code, title, sort from purpose_tree;
update app.parameter_options o set parent_id = par.id
  from purpose_tree t join app.parameter_options par
    on par.code = t.parent and par.parameter_id = (select id from app.parameters where code = 'program_purpose')
 where o.code = t.code and o.parameter_id = par.parameter_id;

-- ── 3. Формат строки программы — как в WIKI ─────────────────────────────────

-- «Раздел» заменён «Назначением»: значений с ним в базе нет (проверено).
delete from app.parameter_set_items
 where parameter_id = (select id from app.parameters where code = 'program_section');
delete from app.parameter_options
 where parameter_id = (select id from app.parameters where code = 'program_section');
delete from app.parameters where code = 'program_section';

update app.parameters set title_ru = 'Людей', unit = 'чел.',
       definition = 'Расчётное число людей; смысл задаёт зона: зрительские места, рабочие места, ученики, места в гримёрных, проживающие.'
 where code = 'program_seats';

insert into app.parameters (code, title_ru, value_type, unit, definition, sort_order) values
  ('program_part', 'Часть здания', 'text', null, 'Зал или корпус, к которому относится помещение: «Большой театр», «корпус Б», «общее».', 25),
  ('program_number', '№', 'text', null, 'Номер помещения по источнику.', 35),
  ('program_area_basis', 'Основание площади', 'option', null, 'Откуда площадь: по документу, по габаритам, оценка, не указана.', 60),
  ('program_dimensions', 'Габариты', 'text', 'м', 'Размеры в плане, если площадь посчитана по ним: «19,02 × 13,23».', 65),
  ('program_in_total', 'В итог', 'option', null, '«Нет» — для того, что даст двойной счёт: колосники над сценой, открытые террасы.', 70),
  ('program_source', 'Источник', 'text', null, 'Документ и страница: «Технический паспорт GT, стр. 41».', 75);

insert into app.parameter_options (parameter_id, code, title_ru, sort_order)
select p.id, x.code, x.title, x.sort from app.parameters p,
       (values ('program_area_basis', 'document', 'по документу', 10),
               ('program_area_basis', 'dimensions', 'по габаритам', 20),
               ('program_area_basis', 'estimate', 'оценка', 30),
               ('program_area_basis', 'unknown', 'не указана', 40),
               ('program_in_total', 'yes', 'да', 10),
               ('program_in_total', 'no', 'нет', 20)) as x(param, code, title, sort)
 where p.code = x.param;

-- Порядок колонок — как в WIKI.
update app.parameters p set sort_order = x.sort
  from (values ('program_purpose', 10), ('program_room', 20), ('program_part', 25), ('program_level', 30),
               ('program_number', 35), ('program_count', 40), ('program_seats', 45), ('program_area', 50),
               ('program_area_total', 55), ('program_area_basis', 60), ('program_dimensions', 65),
               ('program_in_total', 70), ('program_source', 75), ('program_note', 80)) as x(code, sort)
 where p.code = x.code;

insert into app.parameter_set_items (set_id, parameter_id, sort_order)
select s.id, p.id, p.sort_order from app.parameter_sets s join app.parameters p
    on p.code in ('program_purpose', 'program_part', 'program_number', 'program_area_basis',
                  'program_dimensions', 'program_in_total', 'program_source')
 where s.code = 'program_row';
update app.parameter_set_items i set sort_order = p.sort_order
  from app.parameters p, app.parameter_sets s
 where i.parameter_id = p.id and i.set_id = s.id and s.code = 'program_row';

-- ── 4. Итоги по зонам и назначениям ─────────────────────────────────────────

-- Строки с «В итог: нет» не складываются. Итог — по зоне (корень дерева) и
-- внутри зоны — по назначению второго уровня.
create or replace function app.area_program_totals(p_entity bigint, p_drafts boolean) returns jsonb
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
    select v.indicator, app.program_row_area(x.r) as area,
           (x.r ->> (select id::text from app.parameters where code = 'program_seats'))::numeric as people,
           app.option_path((x.r ->> (select id::text from app.parameters where code = 'program_purpose'))::uuid) as path
      from v cross join lateral jsonb_array_elements(v.value->'table_value') x(r)
     where coalesce(x.r ->> (select id::text from app.parameters where code = 'program_in_total'), '')
           <> (select o.id::text from app.parameter_options o join app.parameters p on p.id = o.parameter_id
                where p.code = 'program_in_total' and o.code = 'no')
  ),
  purposes as (
    select indicator, path->0 as zone, coalesce(path->1, path->0) as purpose,
           sum(area) as area, sum(people) as people
      from rows group by indicator, path->0, coalesce(path->1, path->0)
  ),
  zones as (
    select indicator, zone, sum(area) as area, sum(people) as people,
           jsonb_agg(jsonb_build_object('code', purpose->>'code', 'title', purpose->>'title',
                                        'area', area, 'people', people)
                     order by (select sort_order from app.parameter_options where code = purpose->>'code'
                                 and parameter_id = (select id from app.parameters where code = 'program_purpose'))) as purposes
      from purposes group by indicator, zone
  ),
  shared as (select z.*, sum(z.area) over (partition by z.indicator->>'id') as total from zones z)
  select coalesce(jsonb_agg(g order by (g->>'sort')::int), '[]'::jsonb) from (
    select jsonb_build_object(
             'indicator_id', s.indicator->>'id',
             'title', s.indicator->>'title',
             'sort', coalesce((s.indicator->>'sort_order')::int, 0),
             'total_area', max(s.total),
             'zones', jsonb_agg(jsonb_build_object(
                 'code', coalesce(s.zone->>'code', ''), 'title', coalesce(s.zone->>'title', 'Без назначения'),
                 'area', s.area, 'people', s.people,
                 'share', round(s.area / nullif(s.total, 0), 4),
                 'purposes', s.purposes)
               order by (select sort_order from app.parameter_options where code = s.zone->>'code'
                           and parameter_id = (select id from app.parameters where code = 'program_purpose')) nulls last)) as g
      from shared s
     group by s.indicator
  ) t
$$;

grant execute on function app.option_path(uuid) to app_api;
