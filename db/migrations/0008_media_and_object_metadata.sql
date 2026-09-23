-- 0008: расширение сведений о медиа и об объектах.
--
-- Решение пользователя 2026-09-23 по итогам первой работы с формой: полей для
-- описания изображений и объектов не хватает.
--
-- Что добавляется и почему:
--   * вид изображения (план, разрез, фасад, фотография) — по нему автор
--     выбирает иллюстрацию для конкретного места в тексте, а не общую обложку;
--   * происхождение изображения: автор съёмки, где хранится, инвентарный номер,
--     подпись источника. Автор снимка и загрузивший файл — разные люди;
--   * сохранность объекта: существует, утрачен, не построен. Для учебного
--     разбора это первое, что нужно знать, и в датировках это не выражается;
--   * размеры и материалы: их спрашивают в каждой карточке здания.
--
-- Неизвестное остаётся пустым: домысливать сведения об объектах нельзя.

-- ── Виды изображений ────────────────────────────────────────────────────────

create table app.media_kinds (
    id          uuid primary key default gen_random_uuid(),
    code        text not null unique,
    title_ru    text not null,
    sort_order  integer not null default 0
);
comment on table app.media_kinds is 'Вид изображения: фотография, план, разрез и другие.';

insert into app.media_kinds (code, title_ru, sort_order) values
    ('photo',     'Фотография',        10),
    ('plan',      'План',              20),
    ('section',   'Разрез',            30),
    ('elevation', 'Фасад',             40),
    ('drawing',   'Чертёж',            50),
    ('scheme',    'Схема',             60),
    ('sketch',    'Эскиз',             70),
    ('model',     'Макет или модель',  80),
    ('map',       'Карта',             90),
    ('portrait',  'Портрет',          100),
    ('document',  'Документ',         110),
    ('poster',    'Афиша',            120),
    ('still',     'Кадр',             130);

-- ── Сведения об изображении ─────────────────────────────────────────────────

alter table app.media_assets
    add column if not exists kind_id           uuid references app.media_kinds(id),
    add column if not exists description       text,
    add column if not exists author            text,
    add column if not exists created_year      integer,
    add column if not exists created_note      text,
    add column if not exists holder            text,
    add column if not exists inventory_no      text,
    add column if not exists original_caption  text,
    add column if not exists keywords          text[] not null default '{}';

comment on column app.media_assets.author is
    'Автор изображения: фотограф, чертёжник. Не совпадает с загрузившим файл';
comment on column app.media_assets.credit is
    'Атрибуция правообладателя или публикации, как её требуется указывать';
comment on column app.media_assets.created_year is 'Год создания изображения, не объекта';
comment on column app.media_assets.created_note is
    'Уточнение датировки изображения: «около 1930», «до перестройки»';
comment on column app.media_assets.holder is 'Где хранится оригинал: архив, музей, собрание';
comment on column app.media_assets.original_caption is
    'Подпись источника дословно; наша подпись хранится в caption_ru';

create index media_assets_kind_idx     on app.media_assets(kind_id);
create index media_assets_keywords_idx on app.media_assets using gin(keywords);

-- ── Сохранность объекта ─────────────────────────────────────────────────────

create table app.object_statuses (
    id          uuid primary key default gen_random_uuid(),
    code        text not null unique,
    title_ru    text not null,
    sort_order  integer not null default 0
);
comment on table app.object_statuses is 'Состояние объекта: существует, утрачен, не построен и подобные.';

insert into app.object_statuses (code, title_ru, sort_order) values
    ('existing',           'Существует',           10),
    ('altered',            'Существует с изменениями', 20),
    ('under_construction', 'Строится',             30),
    ('ruins',              'Руины',                40),
    ('lost',               'Утрачен',              50),
    ('unbuilt',            'Не построен',          60),
    ('unknown',            'Сведений нет',         70);

alter table app.object_profile
    add column if not exists status_id        uuid references app.object_statuses(id),
    add column if not exists current_use      text,
    add column if not exists materials         text,
    add column if not exists floors           smallint check (floors between -5 and 200),
    add column if not exists area_sq_m        numeric(12, 2) check (area_sq_m >= 0),
    add column if not exists height_m         numeric(8, 2) check (height_m >= 0),
    add column if not exists capacity         integer check (capacity >= 0),
    add column if not exists heritage_status  text;

comment on column app.object_profile.current_use is 'Как объект используется сейчас';
comment on column app.object_profile.materials is 'Основные материалы и конструкции';
comment on column app.object_profile.capacity is 'Вместимость: зрителей, жителей, посетителей';
comment on column app.object_profile.heritage_status is 'Охранный статус, если он есть';

-- ── Сведения об участнике ───────────────────────────────────────────────────

alter table app.person_profile
    add column if not exists known_for   text,
    add column if not exists country     text,
    add column if not exists website_url text;

comment on column app.person_profile.known_for is 'Чем известен: одной строкой для карточки и списков';
