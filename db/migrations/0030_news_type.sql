-- Тип «Новость» (Р-88, Р-94): новость сайта — запись, а не новая таблица.
--
-- Решение пользователя 2026-10-03: «Создай тип НОВОСТИ — и опиши её в WIKI».
-- ТЗ — WIKI/Новости.md. Новость стоит в ветви «Служебные», рядом с другими
-- учебными текстами сайта; её текст, карточка и форма редактора — те же, что
-- у ветви (текст-блоки с упоминаниями и источниками, как у проекта), поэтому
-- отображение отдельно не настраивается: берётся ближайшее вверх по дереву.
-- Первоисточник — связь «источник» к записи «Веб-страница», фото — связь
-- «иллюстрация» к записи «Изображение» (Р-80, Р-84, Р-90). Новых таблиц нет.

-- ── 1. Тип ───────────────────────────────────────────────────────────────────

insert into app.entity_types (parent_id, code, title_ru, sort_order)
select id, 'news', 'Новость', 5 from app.entity_types where code = 'service';

-- ── 2. Сведения ──────────────────────────────────────────────────────────────

-- Адрес первоисточника (url) и дата его публикации (publication) уже есть.
insert into app.parameters (code, title_ru, value_type, is_repeatable, definition, sort_order) values
  ('news_topic', 'Тема новости', 'option', true,
   'Архитектура, нейрогенерация, архитектурное ПО — можно несколько.', 10),
  ('news_score', 'Значимость', 'integer', false,
   'Оценка робота новостей 0–100: интерес для студента-архитектора. Обоснование — в примечании значения.', 20),
  ('news_release', 'Выход', 'date', false,
   'День выхода на главную. Заполнен — новость в очереди выхода.', 30),
  ('news_release_time', 'Время выхода', 'text', false,
   'Слот выхода ЧЧ:ММ по московскому времени, из news.release.slots (09:30, 13:00, 18:00).', 40);

insert into app.parameter_options (parameter_id, code, title_ru, sort_order)
select p.id, x.code, x.title, x.sort
  from app.parameters p,
       (values ('architecture', 'Архитектура', 10),
               ('neurogeneration', 'Нейрогенерация', 20),
               ('software', 'Архитектурное ПО', 30)) as x(code, title, sort)
 where p.code = 'news_topic';

insert into app.parameter_sets (code, title_ru, note, sort_order) values
  ('news_basic', 'Новость — сведения',
   'Первоисточник, тема, значимость и выход новости (Р-88).', 80);

insert into app.parameter_set_items (set_id, parameter_id, sort_order)
select s.id, p.id, x.sort
  from app.parameter_sets s,
       (values ('url', 10), ('publication', 20), ('news_topic', 30), ('news_score', 40),
               ('news_release', 50), ('news_release_time', 60)) as x(code, sort)
  join app.parameters p on p.code = x.code
 where s.code = 'news_basic';

insert into app.type_parameter_sets (type_id, set_id)
select t.id, s.id from app.entity_types t, app.parameter_sets s
 where t.code = 'news' and s.code = 'news_basic';
