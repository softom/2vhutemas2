-- 0006: наполнение словарей нового контура.
--
-- Составы видов сущностей, типов объектов, ролей вложений, видов источников,
-- типов участников и тем периодов повторяют словари старого проекта: они
-- проверены практикой и обеспечивают перенос данных без переизобретения.
-- Виды дат и роли связей — новые, по решениям Р-08 и обсуждению связей.
--
-- Идентификаторы видов сущностей постоянны: на них ссылаются проверки профилей
-- в 0002. Остальные словари получают идентификаторы при вставке.

insert into app.entity_kinds(id, code, title_ru, sort_order) values
    ('00000000-0000-4000-a000-0000000000e1', 'person', 'Человек / организация', 10),
    ('00000000-0000-4000-a000-0000000000e2', 'object', 'Объект / произведение',  20),
    ('00000000-0000-4000-a000-0000000000e3', 'period', 'Период / явление',       30)
on conflict (code) do nothing;

insert into app.object_types(code, title_ru, sort_order) values
    ('architecture_object', 'Архитектурный объект',        10),
    ('urban_concept',       'Градостроительная концепция', 20),
    ('environment_object',  'Средовой объект',             30),
    ('competition_entry',   'Конкурсная работа',           40),
    ('study_work',          'Учебная работа',              50),
    ('theory_concept',      'Концепция (теория)',          60),
    ('memorandum',          'Меморандум (хартия)',         70),
    ('book',                'Книга',                       80),
    ('article',             'Статья',                      90),
    ('film',                'Фильм',                      100),
    ('music',               'Музыка',                     110),
    ('performance',         'Постановка',                 120),
    ('event',               'Событие',                    130)
on conflict (code) do nothing;

insert into app.person_types(code, title_ru, sort_order) values
    ('person',  'Человек',  10),
    ('company', 'Компания', 20),
    ('group',   'Группа',   30)
on conflict (code) do nothing;

insert into app.reference_kinds(code, title_ru, sort_order) values
    ('quote',   'Цитата',  10),
    ('slogan',  'Слоган',  20),
    ('url',     'Ссылка',  30),
    ('wiki',    'Wiki',    40),
    ('book',    'Книга',   50),
    ('article', 'Статья',  60)
on conflict (code) do nothing;

insert into app.attachment_roles(code, title_ru, sort_order) values
    ('cover',         'Обложка',           10),
    ('gallery',       'Галерея',           20),
    ('wiki',          'Wiki',              30),
    ('slogan',        'Слоган',            40),
    ('quote',         'Цитата',            50),
    ('source',        'Источник',          60),
    ('justification', 'Обоснование связи', 70),
    ('description',   'Описание',          80)
on conflict (code) do nothing;

-- Виды дат (Р-08). applies_to подсказывает интерфейсу, что предлагать,
-- но не запрещает: у здания бывает дата утраты, у человека — дата работы.
insert into app.date_kinds(code, title_ru, applies_to, sort_order) values
    ('birth',              'Рождение',             'person', 10),
    ('death',              'Смерть',               'person', 20),
    ('founded',            'Основание',            'person', 30),
    ('dissolved',          'Закрытие',             'person', 40),
    ('design',             'Проектирование',       'object', 50),
    ('construction_start', 'Начало строительства', 'object', 60),
    ('opening',            'Открытие',             'object', 70),
    ('reconstruction',     'Реконструкция',        'object', 80),
    ('loss',               'Утрата',               'object', 90),
    ('publication',        'Публикация',           'object', 100),
    ('period_start',       'Начало периода',       'period', 110),
    ('period_end',         'Конец периода',        'period', 120)
on conflict (code) do nothing;

-- Роли связи — необязательная метка участия. Прав доступа не дают,
-- связь может существовать и без роли.
insert into app.link_roles(code, title_ru, sort_order) values
    ('architect',   'Архитектор',     10),
    ('engineer',    'Инженер',        20),
    ('author',      'Автор',          30),
    ('participant', 'Участник',       40),
    ('publisher',   'Издатель',       50),
    ('influence',   'Влияние',        60),
    ('location',    'Место',          70),
    ('depicts',     'Изображает',     80)
on conflict (code) do nothing;

insert into app.period_types(theme_code, theme_title_ru, section_code, section_title_ru, hierarchy_level, sort_order) values
    ('art',      'Искусство', 'epochs',    'Стилистические эпохи',      1, 10),
    ('art',      'Искусство', 'styles',    'Стили',                     1, 20),
    ('science',  'Наука',     'epochs',    'Познавательные эпохи',      1, 30),
    ('science',  'Наука',     'methods',   'Методы и подходы',          1, 40),
    ('religion', 'Религия',   'epochs',    'Духовно-философские эпохи', 1, 50),
    ('religion', 'Религия',   'teachings', 'Учения и течения',          1, 60)
on conflict (theme_code, section_code) do nothing;
