-- 0018: ветвь «Учебное» и тип «Лекция» (решения Р-37, Р-38, правило 18).
--
-- Лекция — текст со ссылками на объекты. Отдельной таблицы ей не нужно:
-- текст живёт документом-описанием, ссылки собираются указателем вхождений,
-- а номер и курс — параметры. Новой сущности не появляется.
--
-- Почему отдельная верхняя ветвь, а не тип под «Что»: нынешнее дерево
-- описывает предмет изучения — кто, что и когда. Лекция же наш материал
-- об этом предмете. Разный род записи, и в каталоге их надо различать
-- одним движением: отбор по ветви это и делает.

insert into app.entity_types (id, parent_id, code, title_ru, sort_order) values
    ('00000000-0000-4000-a000-0000000000e4', null, 'learning', 'Учебное', 40);

insert into app.entity_types (parent_id, code, title_ru, sort_order)
values ('00000000-0000-4000-a000-0000000000e4', 'lecture', 'Лекция', 10);

-- Название лекции — это название записи: второго места для него не заводим.
insert into app.parameters (code, title_ru, value_type, is_repeatable, definition, sort_order)
values
    ('lecture_number', 'Номер лекции', 'integer', false,
     'Порядковый номер в курсе', 410),
    ('course', 'Курс', 'text', false,
     'Курс, к которому относится материал. Станет списком, когда курсы будут названы', 420);

insert into app.parameter_sets (code, title_ru, note, sort_order)
values ('lecture_basic', 'Лекция', 'Номер и курс; название и текст у записи общие', 40);

insert into app.parameter_set_items (set_id, parameter_id, sort_order)
select s.id, p.id, x.sort_order
  from (values ('course', 10), ('lecture_number', 20)) as x(code, sort_order)
  join app.parameters p on p.code = x.code
  join app.parameter_sets s on s.code = 'lecture_basic';

insert into app.type_parameter_sets (type_id, set_id)
select ty.id, s.id
  from app.entity_types ty, app.parameter_sets s
 where ty.code = 'learning' and s.code = 'lecture_basic';
