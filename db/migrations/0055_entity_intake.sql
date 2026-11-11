-- Approved 2026-11-11: independent entity dossiers, sources and source media.
create table app.entity_intake (
 id uuid primary key, title text not null check(length(title) between 1 and 500),
 description text not null default '', status text not null default 'proposed'
 check(status in ('proposed','reviewing','needs_info','ready','done','rejected')),
 reason text not null default '', target_entity_id bigint references app.entities(id),
 version integer not null default 1, history jsonb not null default '[]'::jsonb,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 created_by uuid references app.contributors(id), updated_by uuid references app.contributors(id)
);
create table app.entity_intake_sources (
 id uuid primary key, intake_id uuid not null references app.entity_intake(id),
 url text not null default '', title text not null, description text not null default '',
 publisher text not null default '', author text not null default '', published_at date,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 created_by uuid references app.contributors(id), updated_by uuid references app.contributors(id)
);
create table app.entity_intake_media (
 id uuid primary key, source_id uuid not null references app.entity_intake_sources(id),
 url text not null default '', media_entity_id bigint references app.entities(id),
 kind text not null default 'image', caption text not null default '', author text not null default '',
 status text not null default 'link' check(status in ('link','stored','error')),
 error text not null default '',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 created_by uuid references app.contributors(id), updated_by uuid references app.contributors(id),
 check(status <> 'stored' or media_entity_id is not null)
);
create index entity_intake_status_idx on app.entity_intake(status, updated_at desc);
create index entity_intake_sources_parent_idx on app.entity_intake_sources(intake_id);
create index entity_intake_media_parent_idx on app.entity_intake_media(source_id);
create trigger entity_intake_audit before insert or update on app.entity_intake for each row execute function app.tg_set_audit();
create trigger entity_intake_sources_audit before insert or update on app.entity_intake_sources for each row execute function app.tg_set_audit();
create trigger entity_intake_media_audit before insert or update on app.entity_intake_media for each row execute function app.tg_set_audit();
-- API alone is authorized; no direct anonymous/authenticated grants.
revoke all on app.entity_intake, app.entity_intake_sources, app.entity_intake_media from public, anon, authenticated;
grant select, insert, update on app.entity_intake to app_api;
grant select, insert, update, delete on app.entity_intake_sources, app.entity_intake_media to app_api;
comment on column app.entity_intake.history is 'Prior complete dossiers with actor/time; appended server-side in the same transaction. Not accepted from clients.';
