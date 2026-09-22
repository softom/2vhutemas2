-- 0005: права роли app_api.
--
-- Роль создана отдельно от миграций, потому что при создании задаётся пароль:
-- он живёт в /opt/2vhutemas-services/app-api/.env на сервере и в репозиторий
-- не попадает (правила 9 и 10 проекта).
--
-- API работает от этой роли: читает и пишет в своей схеме app, читает старый
-- контур для будущего переноса и не может менять структуру БД.

grant usage on schema app to app_api;
grant select, insert, update, delete on all tables in schema app to app_api;
grant usage, select on all sequences in schema app to app_api;

alter default privileges in schema app
    grant select, insert, update, delete on tables to app_api;
alter default privileges in schema app
    grant usage, select on sequences to app_api;

-- Старый контур — только чтение, для переноса данных.
grant usage on schema v2 to app_api;
grant select on all tables in schema v2 to app_api;

grant select on
    public.projects, public.authors, public.styles, public.phenomena,
    public.features, public.media_assets, public.reference_entries,
    public.project_author, public.project_style, public.project_feature,
    public.project_media, public.phenomenon_style, public.reference_author,
    public.style_reference
to app_api;

-- Ведомость студентов роли API недоступна: учебные результаты не входят
-- в контур материалов (см. ТЗ, раздел о правах).
