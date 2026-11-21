alter table app.page_layout
  add column display_options jsonb not null default '{}' check (jsonb_typeof(display_options) = 'object'),
  add column call_params jsonb not null default '{}' check (jsonb_typeof(call_params) = 'object'),
  add column call_entity_id bigint generated always as ((call_params->>'entity_id')::bigint) stored
    references app.entities(id) on delete restrict;
