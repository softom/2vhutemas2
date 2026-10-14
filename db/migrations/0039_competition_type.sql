-- Тип «Конкурс» (Р-89, Р-122): конкурс — запись, а не новая таблица.
--
-- Указание пользователя 2026-10-01: «Конкурсы надо держать в отдельной
-- категории сущностей со ссылкой на регистрацию, и отслеживая результаты»;
-- 2026-10-13: «и правда закроем вопрос СУЩНОСТИ». ТЗ — WIKI/Конкурсы.md.
-- Конкурс — событие со сроками: дочерний узел «События». Текст, карточка,
-- форма редактора и адрес участка (параметр «Адрес объекта») приходят от
-- ветви «Что»; отображение отдельно не настраивается. Организатор, жюри и
-- работы — связи; итог работы — её параметр. Новых таблиц нет.

-- ── 1. Тип ───────────────────────────────────────────────────────────────────

insert into app.entity_types (parent_id, code, title_ru, sort_order)
select id, 'competition', 'Конкурс', 10 from app.entity_types where code = 'event';

-- ── 2. Сведения конкурса ─────────────────────────────────────────────────────

-- Страница конкурса — существующий «Адрес страницы» (url): он же ключ от повторов.
insert into app.parameters (code, title_ru, value_type, is_repeatable, definition, sort_order) values
  ('registration_url', 'Регистрация', 'text', false,
   'Адрес, по которому подают заявку на конкурс.', 2310),
  ('competition_state', 'Состояние конкурса', 'option', false,
   'Объявлен, приём заявок, работа жюри, итоги объявлены или отменён.', 2320),
  ('registration_period', 'Срок регистрации', 'date', false,
   'Начало и конец регистрации, если она отдельна от подачи работ.', 2330),
  ('submission_deadline', 'Подача работ до', 'date', false,
   'Главный срок конкурса: последний день подачи работ.', 2340),
  ('results_date', 'Объявление итогов', 'date', false,
   'День, когда организатор объявляет итоги; с него проверяются результаты.', 2350),
  ('prize_fund', 'Призовой фонд', 'text', false,
   'Как у организатора: «$120 000+», «гранты на обучение».', 2360),
  ('eligibility', 'Кто участвует', 'option', true,
   'Кому открыт конкурс — можно несколько.', 2370),
  ('entry_fee', 'Взнос', 'text', false,
   'Плата за участие: «бесплатно», «€50 до 1.11».', 2380),
  ('competition_format', 'Формат конкурса', 'option', false,
   'Открытый идейный, открытый на реализацию или по приглашению.', 2390),
  ('competition_result', 'Итог на конкурсе', 'option', false,
   'Итог конкурсной работы; пояснение («приз зрительских симпатий») — в примечании значения.', 2400);

insert into app.parameter_options (parameter_id, code, title_ru, sort_order)
select p.id, x.code, x.title, x.sort
  from app.parameters p
  join (values
    ('competition_state', 'announced', 'Объявлен', 10),
    ('competition_state', 'open', 'Приём заявок', 20),
    ('competition_state', 'jury', 'Работа жюри', 30),
    ('competition_state', 'results', 'Итоги объявлены', 40),
    ('competition_state', 'cancelled', 'Отменён', 50),
    ('eligibility', 'students', 'Студенты', 10),
    ('eligibility', 'young_architects', 'Молодые архитекторы', 20),
    ('eligibility', 'professionals', 'Профессионалы', 30),
    ('eligibility', 'all', 'Все', 40),
    ('competition_format', 'open_ideas', 'Открытый идейный', 10),
    ('competition_format', 'open_realization', 'Открытый на реализацию', 20),
    ('competition_format', 'invited', 'По приглашению', 30),
    ('competition_result', 'winner', 'Победитель', 10),
    ('competition_result', 'second', '2-е место', 20),
    ('competition_result', 'third', '3-е место', 30),
    ('competition_result', 'mention', 'Почётное упоминание', 40),
    ('competition_result', 'shortlist', 'Шорт-лист', 50),
    ('competition_result', 'participant', 'Участник', 60)
  ) as x(parameter, code, title, sort) on x.parameter = p.code;

insert into app.parameter_sets (code, title_ru, note, sort_order) values
  ('competition_basic', 'Конкурс — сведения',
   'Страница, регистрация, состояние, сроки, фонд, участники, взнос и формат конкурса (Р-89).', 90),
  ('competition_entry_result', 'Конкурсная работа — итог',
   'Итог работы на конкурсе (Р-89).', 95);

insert into app.parameter_set_items (set_id, parameter_id, sort_order)
select s.id, p.id, x.sort
  from (values
    ('competition_basic', 'url', 10),
    ('competition_basic', 'registration_url', 20),
    ('competition_basic', 'competition_state', 30),
    ('competition_basic', 'registration_period', 40),
    ('competition_basic', 'submission_deadline', 50),
    ('competition_basic', 'results_date', 60),
    ('competition_basic', 'prize_fund', 70),
    ('competition_basic', 'eligibility', 80),
    ('competition_basic', 'entry_fee', 90),
    ('competition_basic', 'competition_format', 100),
    ('competition_entry_result', 'competition_result', 10)
  ) as x(set_code, code, sort)
  join app.parameter_sets s on s.code = x.set_code
  join app.parameters p on p.code = x.code;

insert into app.type_parameter_sets (type_id, set_id)
select t.id, s.id
  from (values ('competition', 'competition_basic'),
               ('competition_entry', 'competition_entry_result')) as x(type_code, set_code)
  join app.entity_types t on t.code = x.type_code
  join app.parameter_sets s on s.code = x.set_code;

-- ── 3. Роли связей ───────────────────────────────────────────────────────────

-- Организатор и жюри: конкурс → человек или компания; «Подана на конкурс»:
-- конкурсная работа → конкурс. Автор работы и источник — существующие роли.
insert into app.link_roles (code, title_ru, sort_order) values
  ('organizer', 'Организатор', 110),
  ('jury', 'Жюри', 120),
  ('submitted_to', 'Подана на конкурс', 130);
