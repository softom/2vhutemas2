begin;
create table app.intake_tokens (
 id uuid primary key default gen_random_uuid(),
 system_name text not null,
 digest text not null unique,
 issued_by uuid not null references app.contributors(id),
 expires_at timestamptz not null,
 created_at timestamptz not null default now()
);
alter table app.entity_intake add column intake_token_id uuid references app.intake_tokens(id);
grant select,insert on app.intake_tokens to app_api;
commit;
