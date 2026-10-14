-- Площадная программа: уточнения по опыту сводки пяти документов.
--
-- Предложения коллеги, переданные пользователем 2026-10-14 («Смотри, есть
-- предложения по структуре»): десять зон оставить; инженерию не расширять, но
-- сузить ТХ; СП 118 — позже. Добавить свойства всей программы, тип площади
-- строки и назначения, понадобившиеся в пяти документах; поправить жильё,
-- санузлы и зону 2.

-- ── 1. Свойства всей программы ──────────────────────────────────────────────
-- Документы считают разное: без этих трёх свойств проценты двух зданий нельзя
-- ставить рядом. Это обычные параметры — в той же группе сведений, что и
-- таблица программы.
insert into app.parameters (code, title_ru, value_type, unit, definition, sort_order) values
  ('program_stage', 'Стадия программы', 'option', null,
   'Что описывает программа: задание на проектирование, проект или построенное здание.', 20),
  ('program_area_base', 'База площади программы', 'option', null,
   'Какую площадь считает документ: полезную (НУФ по DIN 277), общую или только помещения программы.', 30),
  ('program_circulation_method', 'Пути движения и техника в программе', 'option', null,
   'Как документ учитывает коммуникации и инженерию: строками, коэффициентом к полезной площади или отдельно, сверх полезной.', 40),
  ('program_circulation_factor', 'Коэффициент на пути движения и технику', 'number', null,
   'Если коммуникации и техника заданы коэффициентом: например, 1,6 — общая = полезная × 1,6.', 50);

insert into app.parameter_options (parameter_id, code, title_ru, sort_order)
select p.id, x.code, x.title, x.sort from app.parameters p,
       (values ('program_stage', 'brief', 'задание', 10),
               ('program_stage', 'design', 'проект', 20),
               ('program_stage', 'built', 'построено', 30),
               ('program_area_base', 'usable', 'полезная (НУФ, DIN 277)', 10),
               ('program_area_base', 'gross', 'общая', 20),
               ('program_area_base', 'rooms', 'помещения программы', 30),
               ('program_circulation_method', 'rows', 'перечислены строками', 10),
               ('program_circulation_method', 'factor', 'заданы коэффициентом', 20),
               ('program_circulation_method', 'separate', 'отдельно, сверх полезной', 30),
               ('program_circulation_method', 'absent', 'не учтены', 40)) as x(param, code, title, sort)
 where p.code = x.param;

insert into app.parameter_set_items (set_id, parameter_id, sort_order)
select s.id, p.id, p.sort_order from app.parameter_sets s join app.parameters p
    on p.code in ('program_stage', 'program_area_base', 'program_circulation_method', 'program_circulation_factor')
 where s.code = 'area_program';

-- ── 2. Тип площади строки ───────────────────────────────────────────────────
-- Трибуны, поле стадиона, терраса — площадь, но не помещение; в итог они
-- входят, поэтому прятать их в «В итог: нет» нельзя.
insert into app.parameters (code, title_ru, value_type, unit, definition, sort_order) values
  ('program_space_type', 'Тип площади', 'option', null,
   'Помещение, открытая площадь или под навесом. Трибуны, поле, терраса — площадь, но не помещение.', 22);
insert into app.parameter_options (parameter_id, code, title_ru, sort_order)
select p.id, x.code, x.title, x.sort from app.parameters p,
       (values ('room', 'помещение', 10), ('open', 'открытая', 20), ('covered', 'под навесом', 30)) as x(code, title, sort)
 where p.code = 'program_space_type';
insert into app.parameter_set_items (set_id, parameter_id, sort_order)
select s.id, p.id, 22 from app.parameter_sets s, app.parameters p
 where s.code = 'program_row' and p.code = 'program_space_type';

update app.parameters set definition =
  '«Нет» — если площадь уже учтена в другой строке (двойной счёт), а не по названию помещения: колосники Тайбэя входят в площадь этажей.'
 where code = 'program_in_total';

-- ── 3. Дерево назначений ────────────────────────────────────────────────────

create temporary table purpose_add (code text, title text, parent text, sort int) on commit drop;
insert into purpose_add values
  -- Сценическая техника — часть сцены (у Комише-опер «главная сцена, боковые
  -- сцены и сценическая техника» — одна строка), колосники и галереи — тоже.
  ('core.stage_tech', 'Сценическая техника', 'core', 15),
  ('core.flies', 'Колосники, рабочие галереи', 'core', 16),
  -- Санузлы, прихожие, кухни квартир — часть квартиры.
  ('core.apartment_aux', 'Прихожие, санузлы, кухни квартир', 'core', 65),
  ('visitors.hospitality', 'Гостевая зона: ложи, клуб', 'visitors', 35),
  ('performers.wc', 'Санузлы и душевые исполнителей', 'performers', 50),
  ('management.wc', 'Служебные санузлы', 'management', 35),
  ('management.press', 'Пресса', 'management', 60),
  ('management.order', 'Службы порядка: полиция, пожарные, пункт управления', 'management', 70),
  ('management.residential', 'Управляющая компания, диспетчерская, консьерж', 'management', 80),
  ('other.culture', 'Музей, выставка, образование', 'other', 20),
  -- В ТХ — только то, что не является частью сцены.
  ('engineering.tech.projection', 'Кинопроекционные', 'engineering.tech', 30),
  ('engineering.tech.control', 'Аппаратные звука и света', 'engineering.tech', 40),
  ('engineering.tech.machinery', 'Машинные сценической механики', 'engineering.tech', 50);

insert into app.parameter_options (parameter_id, code, title_ru, sort_order, parent_id)
select pp.id, a.code, a.title, a.sort,
       (select o.id from app.parameter_options o where o.parameter_id = pp.id and o.code = a.parent)
  from purpose_add a, app.parameters pp
 where pp.code = 'program_purpose';

update app.parameter_options o set title_ru = x.title
  from (values ('users', 'Места зрителей и слушателей события'),
               ('production.loading', 'Разгрузка и грузовой путь: разгрузочная, грузовой лифт, склад декораций'),
               ('visitors.wc', 'Санузлы посетителей')) as x(code, title)
 where o.code = x.code and o.parameter_id = (select id from app.parameters where code = 'program_purpose');

-- Перенесённые узлы: сценическая механика и колосники — в зону 1, прихожие
-- квартир — в зону 1 (значений с ними в базе нет).
delete from app.parameter_options
 where parameter_id = (select id from app.parameters where code = 'program_purpose')
   and code in ('engineering.tech.stage', 'engineering.tech.flies', 'management.apartment');
