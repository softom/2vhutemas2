-- 0002: базовая модель нового контура — знание.
--
-- Новый проект разрабатывается ПАРАЛЛЕЛЬНО со старым (решение пользователя
-- 2026-09-22). Схемы старого контура — public (legacy), v2 (23 периода старого
-- проекта) — не изменяются ничем из этой миграции. Новый контур живёт в схеме
-- app и заменит старый, когда обгонит его по возможностям.
--
-- Правила, на которых построена схема:
--   * внутренние ссылки только по UID (правило 1 проекта): словари имеют uuid,
--     code остаётся уникальным читаемым атрибутом;
--   * датировки вынесены в entity_dates (Р-08), пар годов в профилях нет;
--   * связь не существует без обоснования — отложенное ограничение;
--   * доступ проверяет API, RLS не включается (пункт 4 «Схемы этапа 1»).

comment on schema app is
    'Новый контур 2vhutemas: сущности, связи, вложения, содержимое, авторство и версии. Старые схемы public и v2 не затрагивает.';

-- ── Служебное ───────────────────────────────────────────────────────────────

-- Действующий пользователь: API кладёт свой идентификатор в app.contributor_id,
-- прямое подключение через Supabase — в claim sub.
create function app.request_user_id() returns uuid language plpgsql stable as $$
declare
    value text;
begin
    value := nullif(current_setting('app.contributor_id', true), '');
    if value is null then
        value := nullif(current_setting('request.jwt.claim.sub', true), '');
    end if;
    return value::uuid;
exception when others then
    return null;
end;
$$;

create function app.tg_set_audit() returns trigger language plpgsql as $$
begin
    if tg_op = 'INSERT' then
        new.created_at := coalesce(new.created_at, now());
        new.created_by := coalesce(new.created_by, app.request_user_id());
    else
        new.created_at := old.created_at;
        new.created_by := old.created_by;
    end if;
    new.updated_at := now();
    new.updated_by := coalesce(app.request_user_id(), new.updated_by);
    return new;
end;
$$;

comment on function app.tg_set_audit() is
    'Заполняет created_at/by и updated_at/by. Технический след правки, не авторство материала.';

-- ── Словари ─────────────────────────────────────────────────────────────────

create table app.entity_kinds (
    id          uuid primary key,
    code        text not null unique,
    title_ru    text not null,
    sort_order  integer not null default 0
);
comment on table app.entity_kinds is 'Виды сущностей. Идентификаторы постоянны: на них опираются проверки профилей.';

create table app.object_types (
    id          uuid primary key default gen_random_uuid(),
    code        text not null unique,
    title_ru    text not null,
    sort_order  integer not null default 0
);

create table app.person_types (
    id          uuid primary key default gen_random_uuid(),
    code        text not null unique,
    title_ru    text not null,
    sort_order  integer not null default 0
);

create table app.reference_kinds (
    id          uuid primary key default gen_random_uuid(),
    code        text not null unique,
    title_ru    text not null,
    sort_order  integer not null default 0
);

create table app.attachment_roles (
    id          uuid primary key default gen_random_uuid(),
    code        text not null unique,
    title_ru    text not null,
    sort_order  integer not null default 0
);

create table app.date_kinds (
    id          uuid primary key default gen_random_uuid(),
    code        text not null unique,
    title_ru    text not null,
    applies_to  text not null default 'any' check (applies_to in ('any', 'person', 'object', 'period')),
    sort_order  integer not null default 0
);
comment on table app.date_kinds is 'Виды дат: рождение, открытие, реконструкция и другие (Р-08).';

create table app.link_roles (
    id          uuid primary key default gen_random_uuid(),
    code        text not null unique,
    title_ru    text not null,
    sort_order  integer not null default 0
);
comment on table app.link_roles is 'Необязательная метка участия в связи: архитектор, издатель и подобные. Прав доступа не даёт.';

create table app.period_types (
    id                uuid primary key default gen_random_uuid(),
    theme_code        text not null,
    theme_title_ru    text not null,
    theme_title_en    text,
    section_code      text not null,
    section_title_ru  text not null,
    section_title_en  text,
    default_color     text,
    hierarchy_level   integer not null default 1 check (hierarchy_level >= 1),
    sort_order        integer not null default 0,
    unique (theme_code, section_code)
);

-- ── Медиа: собственный реестр нового контура ───────────────────────────────
-- Решение пользователя 2026-09-22: новый контур ведёт собственный реестр и не
-- дополняет реестр старого проекта. Файлы старого контура переносятся отдельной
-- работой с таблицей соответствия идентификаторов; старый реестр не изменяется.

create table app.media_assets (
    id            uuid primary key default gen_random_uuid(),
    asset_class   text not null default 'image'
                  check (asset_class in ('image', 'pdf', 'video', 'audio', 'doc', 'other')),
    caption_ru    text,
    alt_text      text,
    credit        text,
    source_url    text,
    license_code  text,
    license_url   text,
    visibility    text not null default 'private' check (visibility in ('public', 'private')),
    is_published  boolean not null default false,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),
    created_by    uuid,
    updated_by    uuid,
    archived_at   timestamptz
);
comment on table app.media_assets is
    'Реестр изображений и файлов нового контура. Физические варианты — в app.media_files.';
comment on column app.media_assets.credit is 'Автор и атрибуция источника; отличается от загрузившего пользователя';
comment on column app.media_assets.is_published is 'Производный признак: ведётся триггером от materials.status';

create table app.media_files (
    id                uuid primary key default gen_random_uuid(),
    asset_id          uuid not null references app.media_assets(id) on delete cascade,
    variant           text not null check (variant in ('original', 'screen', 'thumbnail')),
    source_file_id    uuid references app.media_files(id) on delete set null,
    storage_backend   text not null default 'fs',
    storage_key       text,
    original_name     text,
    mime_type         text,
    size_bytes        bigint,
    width             integer,
    height            integer,
    sha256            text,
    status            text not null default 'pending'
                      check (status in ('pending', 'processing', 'ready', 'failed')),
    recipe_version    text,
    transform_params  jsonb not null default '{}'::jsonb,
    is_current        boolean not null default true,
    error_code        text,
    created_at        timestamptz not null default now(),
    generated_at      timestamptz,
    constraint media_files_original_has_no_source_chk
        check ((variant = 'original') = (source_file_id is null)),
    constraint media_files_ready_complete_chk check (
        status <> 'ready' or (storage_key is not null and mime_type is not null
                              and size_bytes is not null and sha256 is not null))
);
comment on table app.media_files is
    'Неизменяемые физические варианты файла. Оригинал не перезаписывается; производная создаётся заново и переключается атомарно.';

create unique index media_files_current_variant_uniq
    on app.media_files(asset_id, variant) where is_current;
create index media_files_asset_idx  on app.media_files(asset_id);
create index media_files_sha256_idx on app.media_files(sha256);

-- ── Сущности и профили ──────────────────────────────────────────────────────

create table app.entities (
    id                 bigint generated by default as identity primary key,
    kind_id            uuid not null references app.entity_kinds(id),
    slug               text not null,
    title_ru           text not null,
    title_original     text,
    original_language  text,
    title_la           text,
    title_en           text,
    is_published       boolean not null default false,
    sort_order         integer not null default 0,
    color              text,
    cover_media_id     uuid references app.media_assets(id) on delete set null,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now(),
    created_by         uuid,
    updated_by         uuid,
    constraint entities_slug_format_chk check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    unique (kind_id, slug),
    unique (id, kind_id)
);
comment on column app.entities.title_la is 'Латинское научное наименование (Р-19)';
comment on column app.entities.is_published is
    'Производный признак: ведётся триггером от materials.status, прямая запись запрещена';

create index entities_kind_idx on app.entities(kind_id);
create index entities_slug_idx on app.entities(slug);

create table app.slug_history (
    kind_id     uuid not null references app.entity_kinds(id),
    slug        text not null,
    entity_id   bigint not null references app.entities(id) on delete cascade,
    changed_at  timestamptz not null default now(),
    primary key (kind_id, slug)
);
comment on table app.slug_history is 'Прежние адреса: устаревший slug перенаправляет на актуальный.';

create table app.object_profile (
    entity_id       bigint primary key references app.entities(id) on delete cascade,
    kind_id         uuid not null default '00000000-0000-4000-a000-0000000000e2'
                    check (kind_id = '00000000-0000-4000-a000-0000000000e2'),
    object_type_id  uuid references app.object_types(id),
    city            text,
    country         text,
    lat             double precision check (lat between -90 and 90),
    lon             double precision check (lon between -180 and 180),
    typology        text,
    foreign key (entity_id, kind_id) references app.entities(id, kind_id) on delete cascade
);
comment on table app.object_profile is 'Свойства объекта. Даты — в app.entity_dates.';

create table app.person_profile (
    entity_id       bigint primary key references app.entities(id) on delete cascade,
    kind_id         uuid not null default '00000000-0000-4000-a000-0000000000e1'
                    check (kind_id = '00000000-0000-4000-a000-0000000000e1'),
    person_type_id  uuid references app.person_types(id),
    full_name       text,
    foreign key (entity_id, kind_id) references app.entities(id, kind_id) on delete cascade
);

create table app.period_profile (
    entity_id       bigint primary key references app.entities(id) on delete cascade,
    kind_id         uuid not null default '00000000-0000-4000-a000-0000000000e3'
                    check (kind_id = '00000000-0000-4000-a000-0000000000e3'),
    period_type_id  uuid references app.period_types(id) on delete restrict,
    foreign key (entity_id, kind_id) references app.entities(id, kind_id) on delete cascade
);

-- ── Датировки ───────────────────────────────────────────────────────────────

create table app.entity_dates (
    id                        uuid primary key default gen_random_uuid(),
    entity_id                 bigint not null references app.entities(id) on delete cascade,
    kind_id                   uuid not null references app.date_kinds(id),
    start_year                integer not null,
    start_month               smallint check (start_month between 1 and 12),
    start_day                 smallint check (start_day between 1 and 31),
    end_year                  integer,
    end_month                 smallint check (end_month between 1 and 12),
    end_day                   smallint check (end_day between 1 and 31),
    is_approximate            boolean not null default false,
    is_ongoing                boolean not null default false,
    source_reference_item_id  bigint,
    note                      text,
    sort_order                integer not null default 0,
    created_at                timestamptz not null default now(),
    updated_at                timestamptz not null default now(),
    created_by                uuid,
    updated_by                uuid,
    constraint entity_dates_month_before_day_chk check (start_day is null or start_month is not null),
    constraint entity_dates_end_month_chk        check (end_day is null or end_month is not null),
    constraint entity_dates_order_chk            check (end_year is null or end_year >= start_year),
    constraint entity_dates_ongoing_chk          check (not (is_ongoing and end_year is not null))
);
comment on table app.entity_dates is
    'Датировки сущности: по записи на вид даты. Год может быть отрицательным — до н. э. Месяц и день необязательны.';

create index entity_dates_entity_idx on app.entity_dates(entity_id);
create index entity_dates_year_idx   on app.entity_dates(start_year);

-- ── Связи ───────────────────────────────────────────────────────────────────

create table app.links (
    id              bigint generated by default as identity primary key,
    from_entity_id  bigint not null references app.entities(id) on delete cascade,
    to_entity_id    bigint not null references app.entities(id) on delete cascade,
    role_id         uuid references app.link_roles(id),
    note            text,
    sort_order      integer not null default 0,
    is_primary      boolean not null default false,
    confidence      text,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    created_by      uuid,
    updated_by      uuid,
    constraint links_not_self_chk check (from_entity_id <> to_entity_id)
);
comment on table app.links is
    'Универсальная связь двух сущностей. Обоснование обязательно: вложение с ролью justification (проверяется при фиксации транзакции).';

create index links_from_idx on app.links(from_entity_id);
create index links_to_idx   on app.links(to_entity_id);

-- ── Содержимое ──────────────────────────────────────────────────────────────

create table app.documents (
    id                   bigint generated by default as identity primary key,
    title                text,
    lang                 text not null default 'ru',
    body_format          text not null default 'blocknote',
    body_schema_version  integer not null default 1,
    body_json            jsonb not null default '[]'::jsonb,
    body_text            text,
    search_vector        tsvector,
    created_at           timestamptz not null default now(),
    updated_at           timestamptz not null default now(),
    created_by           uuid,
    updated_by           uuid,
    constraint documents_format_chk check (body_format in ('blocknote', 'editorjs'))
);
comment on column app.documents.body_json is 'Блоки редактора: текст, порядок, оформление, ссылки на сущности и медиа по ID';
comment on column app.documents.body_text is 'Производный текст для поиска; формирует сервер, отдельно не редактируется';

create index documents_search_idx on app.documents using gin(search_vector);

create table app.reference_items (
    id            bigint generated by default as identity primary key,
    kind_id       uuid not null references app.reference_kinds(id),
    title         text,
    text          text,
    url           text,
    year          integer,
    lang          text,
    reliability   integer,
    commentary    text,
    meta          jsonb not null default '{}'::jsonb,
    is_published  boolean not null default false,
    sort_order    integer not null default 0,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),
    created_by    uuid,
    updated_by    uuid
);
comment on column app.reference_items.is_published is 'Производный признак: ведётся триггером от materials.status';

create index reference_items_kind_idx on app.reference_items(kind_id);

alter table app.entity_dates
    add constraint entity_dates_source_fkey
    foreign key (source_reference_item_id) references app.reference_items(id) on delete set null;

-- ── Цели и вложения ─────────────────────────────────────────────────────────

create table app.targets (
    id         bigint generated by default as identity primary key,
    kind       text not null check (kind in ('entity', 'link')),
    entity_id  bigint unique references app.entities(id) on delete cascade,
    link_id    bigint unique references app.links(id) on delete cascade,
    constraint targets_one_ref_chk check (
        (kind = 'entity' and entity_id is not null and link_id is null) or
        (kind = 'link'   and link_id   is not null and entity_id is null))
);
comment on table app.targets is 'Цель вложения: ровно одна сущность либо одна связь. Создаётся триггером.';

create table app.attachments (
    id                 bigint generated by default as identity primary key,
    target_id          bigint not null references app.targets(id) on delete cascade,
    role_id            uuid not null references app.attachment_roles(id),
    sort_order         integer not null default 0,
    note               text,
    meta               jsonb not null default '{}'::jsonb,
    document_id        bigint references app.documents(id) on delete cascade,
    asset_id           uuid references app.media_assets(id) on delete cascade,
    reference_item_id  bigint references app.reference_items(id) on delete cascade,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now(),
    created_by         uuid,
    updated_by         uuid,
    constraint attachments_one_content_chk
        check (num_nonnulls(document_id, asset_id, reference_item_id) = 1)
);

create index attachments_target_idx on app.attachments(target_id);
create index attachments_role_idx   on app.attachments(role_id);
create unique index attachments_uniq_document  on app.attachments(target_id, document_id, role_id)       where document_id is not null;
create unique index attachments_uniq_asset     on app.attachments(target_id, asset_id, role_id)          where asset_id is not null;
create unique index attachments_uniq_reference on app.attachments(target_id, reference_item_id, role_id) where reference_item_id is not null;

-- ── Триггеры ────────────────────────────────────────────────────────────────

create function app.tg_targets_for_entity() returns trigger language plpgsql as $$
begin
    insert into app.targets(kind, entity_id) values ('entity', new.id)
    on conflict (entity_id) do nothing;
    return null;
end;
$$;

create function app.tg_targets_for_link() returns trigger language plpgsql as $$
begin
    insert into app.targets(kind, link_id) values ('link', new.id)
    on conflict (link_id) do nothing;
    return null;
end;
$$;

-- Связь без обоснования недопустима. Проверка отложена до фиксации транзакции:
-- связь и её обоснование создаются последовательно внутри одной транзакции.
create function app.tg_link_requires_justification() returns trigger language plpgsql as $$
declare
    link_id bigint := coalesce(new.id, old.id);
    found_justification boolean;
begin
    if not exists (select 1 from app.links l where l.id = link_id) then
        return null;
    end if;
    select exists (
        select 1
        from app.attachments a
        join app.targets t on t.id = a.target_id
        join app.attachment_roles r on r.id = a.role_id
        where t.link_id = link_id and r.code = 'justification'
    ) into found_justification;
    if not found_justification then
        raise exception 'Связь % не имеет обоснования: требуется вложение с ролью justification', link_id
            using errcode = 'integrity_constraint_violation';
    end if;
    return null;
end;
$$;

create trigger entities_audit_trg        before insert or update on app.entities        for each row execute function app.tg_set_audit();
create trigger links_audit_trg           before insert or update on app.links           for each row execute function app.tg_set_audit();
create trigger documents_audit_trg       before insert or update on app.documents       for each row execute function app.tg_set_audit();
create trigger reference_items_audit_trg before insert or update on app.reference_items for each row execute function app.tg_set_audit();
create trigger attachments_audit_trg     before insert or update on app.attachments     for each row execute function app.tg_set_audit();
create trigger entity_dates_audit_trg    before insert or update on app.entity_dates    for each row execute function app.tg_set_audit();

create trigger entities_targets_trg after insert on app.entities for each row execute function app.tg_targets_for_entity();
create trigger links_targets_trg    after insert on app.links    for each row execute function app.tg_targets_for_link();

create constraint trigger links_justification_trg
    after insert on app.links
    deferrable initially deferred
    for each row execute function app.tg_link_requires_justification();

create constraint trigger attachments_justification_trg
    after delete on app.attachments
    deferrable initially deferred
    for each row execute function app.tg_link_requires_justification();
