-- Fixed references retain their FK. The context alias is stored verbatim in call_params.
alter table app.page_layout drop column call_entity_id;
alter table app.page_layout
  add check (not (call_params ? 'entity_id') or call_params->'entity_id' = 'null'::jsonb
    or (jsonb_typeof(call_params->'entity_id') = 'string' and call_params->>'entity_id' ~ '^[1-9][0-9]*$')
    or call_params->'entity_id' = '{"alias":".this"}'::jsonb),
  add column call_entity_id bigint generated always as (
    case when jsonb_typeof(call_params->'entity_id') = 'string' then (call_params->>'entity_id')::bigint end
  ) stored references app.entities(id) on delete restrict;

-- Validate the final composition, including slot moves, copies and removal of a repeat.
create function app.check_this_context() returns trigger language plpgsql as $$
declare owner uuid;
begin
  if tg_table_name='layouts' then owner:=new.id; else owner:=new.layout_id; end if;
  if exists (
    select 1 from app.layouts l join app.page_layout s on s.layout_id=l.id
    left join app.page_layout first_slot on first_slot.id=l.first_slot_id
    left join app.page_layout last_slot on last_slot.id=l.last_slot_id
    where l.id=owner and l.page_id<>'39ee9267-1a0e-4928-b608-24bf91f68101'
      and s.call_params->'entity_id'='{"alias":".this"}'::jsonb
      and (l.repeat_mode is null or first_slot.id is null or last_slot.id is null
           or s.sort_order not between first_slot.sort_order and last_slot.sort_order)
  ) then raise exception 'No current entity for .this' using errcode='23514',constraint='slot_this_context'; end if;
  return null;
end $$;
create constraint trigger slot_this_context after insert or update of call_params,sort_order,layout_id
  on app.page_layout deferrable initially deferred for each row execute function app.check_this_context();
create constraint trigger layout_this_context after update of repeat_mode,first_slot_id,last_slot_id
  on app.layouts deferrable initially deferred for each row execute function app.check_this_context();
