-- Explicitly requested 2026-11-17: external description URLs linked by entity ID.
create table app.entity_external_descriptions (
 id uuid primary key,
 entity_id bigint not null references app.entities(id) on delete restrict,
 url text not null check(length(url) between 1 and 4000 and url ~ '^https?://'),
 title text not null default '', excerpt text not null default '',
 provider text not null default '', evidence text not null check(evidence in ('snippet','provided')),
 intake_id uuid references app.entity_intake(id) on delete restrict,
 observations jsonb not null default '[]'::jsonb check(jsonb_typeof(observations)='array'),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 created_by uuid references app.contributors(id), updated_by uuid references app.contributors(id)
);
-- Hash permits long URLs; API verifies URL equality on a hash conflict.
create unique index entity_external_descriptions_url_idx on app.entity_external_descriptions(entity_id,md5(url));
create trigger entity_external_descriptions_audit before insert or update on app.entity_external_descriptions for each row execute function app.tg_set_audit();
revoke all on app.entity_external_descriptions from public,anon,authenticated;
grant select,insert,update on app.entity_external_descriptions to app_api;
comment on table app.entity_external_descriptions is 'External source URLs per entity. Search excerpts are not full articles. Observations are append-only through the API; no automatic publication.';
