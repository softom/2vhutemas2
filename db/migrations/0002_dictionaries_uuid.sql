-- 0002: словари получают UUID, ссылки по кодам переводятся на *_id.
-- Решения: правило 1 проекта (связи только по UID), Р-01 (развиваем v2),
-- пункты 2 и 3 документа «Схема этапа 1».
--
-- Идентификаторы видов сущностей заданы явными константами, а не generated:
-- на них опираются проверки соответствия профиля виду сущности (см. 0003).
-- У схемы v2 нет потребителей (только 23 периода), поэтому старые текстовые
-- колонки удаляются сразу, без переходного периода.

-- 1. Словари: id uuid первичным ключом, code остаётся уникальным атрибутом.

alter table v2.entity_kinds     add column if not exists id uuid not null default gen_random_uuid();
alter table v2.object_types     add column if not exists id uuid not null default gen_random_uuid();
alter table v2.person_types     add column if not exists id uuid not null default gen_random_uuid();
alter table v2.reference_kinds  add column if not exists id uuid not null default gen_random_uuid();
alter table v2.attachment_roles add column if not exists id uuid not null default gen_random_uuid();

-- Фиксированные идентификаторы видов сущностей.
update v2.entity_kinds set id = '00000000-0000-4000-a000-0000000000e1' where code = 'person';
update v2.entity_kinds set id = '00000000-0000-4000-a000-0000000000e2' where code = 'object';
update v2.entity_kinds set id = '00000000-0000-4000-a000-0000000000e3' where code = 'period';

-- 2. Новые ссылки на словари.

alter table v2.entities        add column if not exists kind_id        uuid;
alter table v2.object_profile  add column if not exists object_type_id uuid;
alter table v2.person_profile  add column if not exists person_type_id uuid;
alter table v2.reference_items add column if not exists kind_id        uuid;
alter table v2.attachments     add column if not exists role_id        uuid;

update v2.entities e        set kind_id        = k.id from v2.entity_kinds     k where k.code = e.kind;
update v2.object_profile p  set object_type_id = t.id from v2.object_types     t where t.code = p.object_type;
update v2.person_profile p  set person_type_id = t.id from v2.person_types     t where t.code = p.person_type;
update v2.reference_items r set kind_id        = k.id from v2.reference_kinds  k where k.code = r.kind;
update v2.attachments a     set role_id        = r.id from v2.attachment_roles r where r.code = a.role_code;

-- 3. Замена первичных и внешних ключей словарей.

alter table v2.entities        drop constraint if exists entities_kind_fkey;
alter table v2.object_profile  drop constraint if exists object_profile_object_type_fkey;
alter table v2.person_profile  drop constraint if exists person_profile_person_type_fkey;
alter table v2.reference_items drop constraint if exists snippets_kind_fkey;
alter table v2.reference_items drop constraint if exists reference_items_kind_fkey;
alter table v2.attachments     drop constraint if exists attachments_role_code_fkey;

alter table v2.entity_kinds     drop constraint entity_kinds_pkey,     add primary key (id), add unique (code);
alter table v2.object_types     drop constraint object_types_pkey,     add primary key (id), add unique (code);
alter table v2.person_types     drop constraint person_types_pkey,     add primary key (id), add unique (code);
alter table v2.reference_kinds  drop constraint snippet_kinds_pkey,    add primary key (id), add unique (code);
alter table v2.attachment_roles drop constraint attachment_roles_pkey, add primary key (id), add unique (code);

alter table v2.entities        alter column kind_id        set not null;
alter table v2.attachments     alter column role_id        set not null;
alter table v2.reference_items alter column kind_id        set not null;

alter table v2.entities        add constraint entities_kind_id_fkey        foreign key (kind_id)        references v2.entity_kinds(id);
alter table v2.object_profile  add constraint object_profile_type_id_fkey  foreign key (object_type_id) references v2.object_types(id);
alter table v2.person_profile  add constraint person_profile_type_id_fkey  foreign key (person_type_id) references v2.person_types(id);
alter table v2.reference_items add constraint reference_items_kind_id_fkey foreign key (kind_id)        references v2.reference_kinds(id);
alter table v2.attachments     add constraint attachments_role_id_fkey     foreign key (role_id)        references v2.attachment_roles(id);

-- 4. Удаление текстовых ссылок и восстановление зависящих от них ограничений.

alter table v2.entities        drop constraint if exists entities_kind_slug_key;
alter table v2.entities        drop column kind;
alter table v2.object_profile  drop column object_type;
alter table v2.person_profile  drop column person_type;
alter table v2.reference_items drop column kind;
alter table v2.attachments     drop column role_code;

alter table v2.entities add constraint entities_kind_id_slug_key unique (kind_id, slug);

drop index if exists v2.entities_kind_idx;
drop index if exists v2.reference_items_kind_idx;
drop index if exists v2.attachments_role_idx;
create index entities_kind_id_idx        on v2.entities(kind_id);
create index reference_items_kind_id_idx on v2.reference_items(kind_id);
create index attachments_role_id_idx     on v2.attachments(role_id);

drop index if exists v2.attachments_uniq_document;
drop index if exists v2.attachments_uniq_asset;
drop index if exists v2.attachments_uniq_reference;
create unique index attachments_uniq_document  on v2.attachments(target_id, document_id, role_id)       where document_id is not null;
create unique index attachments_uniq_asset     on v2.attachments(target_id, asset_id, role_id)          where asset_id is not null;
create unique index attachments_uniq_reference on v2.attachments(target_id, reference_item_id, role_id) where reference_item_id is not null;

-- 5. Опора для проверки «профиль соответствует виду сущности» (используется в 0003).

alter table v2.entities add constraint entities_id_kind_id_key unique (id, kind_id);

comment on column v2.entities.kind_id is 'Вид сущности из v2.entity_kinds';
comment on column v2.entities.title_la is 'Латинское научное наименование (решение Р-19)';
