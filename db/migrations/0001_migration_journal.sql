-- 0001: журнал миграций.
-- Решение Р-12: нумерованные SQL-файлы, только вперёд, одна транзакция на файл,
-- контрольная сумма защищает от изменения уже применённого файла.
-- Первая миграция создаёт журнал и регистрирует себя сама (делает раннер).

create table if not exists v2.schema_migrations (
    number        integer     primary key,
    filename      text        not null unique,
    checksum      text        not null,
    applied_at    timestamptz not null default now(),
    applied_by    text        not null default current_user,
    duration_ms   integer
);

comment on table v2.schema_migrations is
    'RU: Журнал применённых миграций проекта. Повторное применение файла с изменившейся контрольной суммой отклоняется.';
comment on column v2.schema_migrations.checksum is 'SHA-256 файла миграции на момент применения';
