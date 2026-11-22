begin;
alter table app.intake_tokens add column scopes text[] not null default array['intake']::text[]
  check (cardinality(scopes)>0 and scopes <@ array['intake','edit_cards']::text[]);
commit;
