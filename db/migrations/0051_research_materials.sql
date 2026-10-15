-- Материалы в работе: папка исследований у записи и опись её файлов.
--
-- Решение пользователя 2026-10-15: по объектам собираются материалы, которые
-- публиковать рано, но хранить и видеть нужно. Файлы остаются в папке
-- research_notes (D:\WORK\2Vhutemas\research_notes); новые папки — по типам
-- («ОБЪЕКТЫ», «ЛЮДИ», …), внутри по алфавиту; уже собранное остаётся на месте.
-- «Ссылку на хранение держать в БД в сущности».
--
-- Ссылка — отдельной таблицей, а не колонкой entities: строка записи целиком
-- попадает в снимок версии и в опубликованное чтение, и путь к папке ушёл бы
-- гостям. Эти таблицы вне версий и публикации; читают и пишут их редакторы.
-- Опись присылает скрипт tools/sync_materials.py; сами файлы на сервер не
-- уходят. Файл, уже загруженный в медиатеку, узнаётся по контрольной сумме.

create table app.entity_materials (
    entity_id  bigint primary key references app.entities(id) on delete cascade,
    path       text not null check (path <> '' and path !~ '(^|/)\.\.(/|$)'),
    synced_at  timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    created_by uuid references app.contributors(id),
    updated_by uuid references app.contributors(id)
);
comment on table app.entity_materials is
  'Папка материалов записи в research_notes (путь от корня папки). Не версионируется и не публикуется.';

create table app.material_files (
    id          uuid primary key default gen_random_uuid(),
    entity_id   bigint not null references app.entity_materials(entity_id) on delete cascade,
    rel_path    text not null,
    size_bytes  bigint not null,
    modified_at timestamptz,
    sha256      text,
    seen_at     timestamptz not null default now(),
    unique (entity_id, rel_path)
);
comment on table app.material_files is
  'Опись файлов папки материалов: путь внутри папки, размер, дата, контрольная сумма. Обновляется синхронизацией.';
create index material_files_sha_idx on app.material_files (sha256);

create trigger entity_materials_audit_trg before insert or update on app.entity_materials
  for each row execute function app.tg_set_audit();

grant select, insert, update, delete on app.entity_materials, app.material_files to app_api;
