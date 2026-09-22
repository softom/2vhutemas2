-- 0003: авторство, версии, публикация, права и импорт.
--
-- Решения: Р-03 (состояние материала — атрибут записи), Р-04 (публикация по
-- праву publish, иначе рассмотрение по праву review), Р-15 (отдельный журнал
-- административных действий пока не заводим), Р-20 (начальные роли).
--
-- materials — реестр редактируемых единиц: карточка, связь, документ, источник,
-- медиа или вложение. Он не заменяет targets: targets отвечает за прикрепление,
-- materials — за авторство, версии и состояние.

-- ── Участники ───────────────────────────────────────────────────────────────

create table app.contributors (
    id            uuid primary key default gen_random_uuid(),
    auth_uid      uuid unique,
    display_name  text not null,
    status        text not null default 'active' check (status in ('active', 'disabled')),
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);
comment on table app.contributors is
    'Авторы и редакторы. Постоянная запись: блокировка аккаунта не удаляет историю и подписи.';
comment on column app.contributors.auth_uid is 'Аккаунт входа Supabase; пусто у технических участников, например импортёра';

create table app.telegram_accounts (
    telegram_user_id  bigint primary key,
    contributor_id    uuid not null unique references app.contributors(id) on delete cascade,
    verified_at       timestamptz not null default now()
);
comment on table app.telegram_accounts is
    'Подтверждённая привязка Telegram. Имя пользователя подтверждением не является.';

-- ── Права ───────────────────────────────────────────────────────────────────

create table app.permissions (
    id           uuid primary key default gen_random_uuid(),
    resource     text not null,
    action       text not null check (action in ('view', 'edit', 'create_delete', 'publish', 'review', 'su')),
    description  text not null,
    unique (resource, action)
);

create table app.roles (
    id          uuid primary key default gen_random_uuid(),
    code        text not null unique,
    title       text not null,
    sort_order  integer not null default 0
);

create table app.role_permissions (
    role_id        uuid not null references app.roles(id) on delete cascade,
    permission_id  uuid not null references app.permissions(id) on delete cascade,
    primary key (role_id, permission_id)
);

create table app.user_roles (
    id              uuid primary key default gen_random_uuid(),
    contributor_id  uuid not null references app.contributors(id) on delete cascade,
    role_id         uuid not null references app.roles(id) on delete restrict,
    granted_by      uuid references app.contributors(id),
    granted_at      timestamptz not null default now(),
    revoked_at      timestamptz
);
comment on table app.user_roles is
    'Назначения ролей. Отзыв не удаляет запись: история назначений сохраняется.';

create unique index user_roles_active_uniq
    on app.user_roles(contributor_id, role_id) where revoked_at is null;

insert into app.permissions(resource, action, description) values
    ('content', 'view',          'Просмотр доступных материалов'),
    ('content', 'edit',          'Изменение существующих материалов с сохранением версии'),
    ('content', 'create_delete', 'Создание и архивирование материалов'),
    ('content', 'publish',       'Публикация версии без чужого рассмотрения'),
    ('content', 'review',        'Рассмотрение чужих версий: принять или отклонить'),
    ('access_control', 'su',     'Полный административный доступ приложения');

insert into app.roles(code, title, sort_order) values
    ('su',          'Администратор', 10),
    ('editor',      'Редактор',      20),
    ('contributor', 'Автор',         30),
    ('reader',      'Читатель',      40);

-- Р-20: su — всё; editor публикует сам и рассматривает чужое;
-- contributor пишет, но публикуется через рассмотрение; reader только читает.
insert into app.role_permissions(role_id, permission_id)
select r.id, p.id from app.roles r, app.permissions p
where (r.code = 'su')
   or (r.code = 'editor'      and p.resource = 'content')
   or (r.code = 'contributor' and p.resource = 'content' and p.action in ('view', 'edit', 'create_delete'))
   or (r.code = 'reader'      and p.resource = 'content' and p.action = 'view');

-- ── Материалы и версии ──────────────────────────────────────────────────────

create table app.materials (
    id                     uuid primary key default gen_random_uuid(),
    status                 text not null default 'draft' check (status in ('draft', 'published', 'archived')),
    kind                   text not null check (kind in ('entity', 'link', 'document', 'reference', 'asset', 'attachment')),
    entity_id              bigint unique references app.entities(id) on delete cascade,
    link_id                bigint unique references app.links(id) on delete cascade,
    document_id            bigint unique references app.documents(id) on delete cascade,
    reference_item_id      bigint unique references app.reference_items(id) on delete cascade,
    asset_id               uuid   unique references app.media_assets(id) on delete cascade,
    attachment_id          bigint unique references app.attachments(id) on delete cascade,
    published_revision_id  uuid,
    archived_at            timestamptz,
    created_at             timestamptz not null default now(),
    updated_at             timestamptz not null default now(),
    created_by             uuid references app.contributors(id),
    constraint materials_one_content_chk check (
        num_nonnulls(entity_id, link_id, document_id, reference_item_id, asset_id, attachment_id) = 1),
    constraint materials_archived_chk check ((status = 'archived') = (archived_at is not null))
);
comment on column app.materials.status is
    'Состояние материала (Р-03): draft — черновик с автосохранением, published — опубликован, archived — архив';
comment on column app.materials.published_revision_id is
    'Версия, которую видит читатель. Меняется только при публикации.';

create table app.revisions (
    id                uuid primary key default gen_random_uuid(),
    material_id       uuid not null references app.materials(id) on delete cascade,
    base_revision_id  uuid,
    edited_by         uuid references app.contributors(id),
    operation         text not null check (operation in ('create', 'edit', 'archive', 'restore', 'publish')),
    summary           text,
    snapshot          jsonb not null,
    schema_version    integer not null default 1,
    change_set_id     uuid,
    created_at        timestamptz not null default now(),
    unique (id, material_id)
);
comment on table app.revisions is
    'Неизменяемые версии. Исправление и откат создают новую версию, прежние не переписываются.';

-- Базовая версия и опубликованная версия принадлежат тому же материалу.
alter table app.revisions
    add constraint revisions_base_same_material_fkey
    foreign key (base_revision_id, material_id) references app.revisions(id, material_id);

alter table app.materials
    add constraint materials_published_revision_fkey
    foreign key (published_revision_id, id) references app.revisions(id, material_id)
    deferrable initially deferred;

create index revisions_material_idx   on app.revisions(material_id, created_at);
create index revisions_change_set_idx on app.revisions(change_set_id);

create table app.material_credits (
    material_id     uuid not null references app.materials(id) on delete cascade,
    contributor_id  uuid not null references app.contributors(id) on delete restrict,
    credit_role     text not null check (credit_role in ('author', 'coauthor', 'translator', 'editor')),
    primary key (material_id, contributor_id, credit_role)
);
comment on table app.material_credits is
    'Авторские подписи материала. Подпись не даёт прав доступа.';

create table app.revision_reviews (
    id           uuid primary key default gen_random_uuid(),
    revision_id  uuid not null references app.revisions(id) on delete cascade,
    reviewer_id  uuid references app.contributors(id),
    decision     text not null check (decision in ('submitted', 'approved', 'rejected', 'published')),
    note         text,
    created_at   timestamptz not null default now()
);
comment on table app.revision_reviews is
    'Ход рассмотрения версии (Р-04): отправлена, принята, отклонена, опубликована.';

create index revision_reviews_revision_idx on app.revision_reviews(revision_id, created_at);

-- ── Публикация: производные признаки ────────────────────────────────────────
-- Единственный источник истины — materials.status и published_revision_id.
-- Признаки is_published в таблицах содержимого нужны спискам и поиску;
-- их ведёт триггер, прямая запись бессмысленна и будет перекрыта.

create function app.tg_sync_published() returns trigger language plpgsql as $$
declare
    published boolean := (new.status = 'published' and new.published_revision_id is not null);
begin
    if new.entity_id is not null then
        update app.entities set is_published = published
        where id = new.entity_id and is_published is distinct from published;
    elsif new.reference_item_id is not null then
        update app.reference_items set is_published = published
        where id = new.reference_item_id and is_published is distinct from published;
    elsif new.asset_id is not null then
        update app.media_assets set is_published = published,
               archived_at = case when new.status = 'archived' then coalesce(archived_at, now()) else null end
        where id = new.asset_id;
    end if;
    return null;
end;
$$;

create trigger materials_sync_published_trg
    after insert or update of status, published_revision_id on app.materials
    for each row execute function app.tg_sync_published();

-- ── Импорт ──────────────────────────────────────────────────────────────────

create table app.import_jobs (
    id                uuid primary key default gen_random_uuid(),
    source_namespace  text not null,
    manifest_version  text not null,
    payload_sha256    text not null,
    idempotency_key   text unique,
    status            text not null default 'validating'
                      check (status in ('validating', 'validated', 'applying', 'done', 'failed')),
    started_by        uuid references app.contributors(id),
    started_at        timestamptz not null default now(),
    finished_at       timestamptz,
    error_summary     text
);

create table app.import_items (
    id            uuid primary key default gen_random_uuid(),
    job_id        uuid not null references app.import_jobs(id) on delete cascade,
    local_key     text not null,
    external_key  text,
    item_kind     text not null,
    plan          text check (plan in ('create', 'update', 'skip')),
    status        text not null default 'pending'
                  check (status in ('pending', 'applied', 'skipped', 'failed')),
    material_id   uuid references app.materials(id) on delete set null,
    error_code    text,
    error_detail  text,
    attempts      integer not null default 0,
    unique (job_id, local_key)
);

create table app.import_key_map (
    source_namespace  text not null,
    external_key      text not null,
    material_id       uuid not null references app.materials(id) on delete cascade,
    first_imported_at timestamptz not null default now(),
    primary key (source_namespace, external_key)
);
comment on table app.import_key_map is
    'Идентичность импорта: пара источник + внешний ключ. Защищает от дублей при повторном запуске; slug для этого не используется.';
