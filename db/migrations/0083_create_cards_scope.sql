begin;
alter table app.intake_tokens drop constraint intake_tokens_scopes_check,
  add constraint intake_tokens_scopes_check check (
    cardinality(scopes)>0 and scopes <@ array['intake','edit_cards','create_cards']::text[]
  );
commit;
