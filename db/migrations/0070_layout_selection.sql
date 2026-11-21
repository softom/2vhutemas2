-- A layout version owns at most one selection. NULL mode preserves old layouts.
alter table app.page_layout add unique(layout_id,id);
alter table app.layouts
  add column source_type_id uuid references app.entity_types(id),
  add column filter_type_id uuid references app.entity_types(id),
  add column filter_text text,
  add column repeat_mode text check (repeat_mode in ('block','journal')),
  add column first_slot_id uuid,
  add column last_slot_id uuid,
  add foreign key(id,first_slot_id) references app.page_layout(layout_id,id) deferrable initially deferred,
  add foreign key(id,last_slot_id) references app.page_layout(layout_id,id) deferrable initially deferred,
  add check (
    (repeat_mode is null and num_nonnulls(source_type_id,filter_type_id,filter_text,first_slot_id,last_slot_id)=0)
    or (repeat_mode is not null and num_nonnulls(source_type_id,first_slot_id,last_slot_id)=3 and
      (page_id,source_type_id) in (
        ('39ee9267-1a0e-4928-b608-24bf91f68102'::uuid,'00000000-0000-4000-a000-0000000000e2'::uuid),
        ('39ee9267-1a0e-4928-b608-24bf91f68103'::uuid,'00000000-0000-4000-a000-0000000000e1'::uuid))));

create function app.selection_changed() returns trigger language plpgsql as $$
begin
  if old.assigned then raise exception 'Assigned layout is immutable' using errcode='23514'; end if;
  if new.filter_type_id is not null and not exists (
    with recursive branch(id) as (
      select new.source_type_id union select t.id from app.entity_types t join branch b on t.parent_id=b.id
    ) select 1 from branch where id=new.filter_type_id
  ) then raise exception 'Filter outside source branch' using errcode='23514'; end if;
  new.revision := old.revision+1;
  return new;
end $$;
create trigger selection_changed before update of source_type_id,filter_type_id,filter_text,repeat_mode,first_slot_id,last_slot_id
  on app.layouts for each row execute function app.selection_changed();
create trigger selection_event after update of source_type_id,filter_type_id,filter_text,repeat_mode,first_slot_id,last_slot_id
  on app.layouts for each row execute function app.layout_event('selection_changed');

-- Verify the final order after a multi-slot edit, including edits made without changing the selection.
create function app.check_repeat_bounds() returns trigger language plpgsql as $$
declare owner uuid;
begin
  if tg_table_name='layouts' then owner:=new.id; else owner:=new.layout_id; end if;
  if exists (select 1 from app.layouts l join app.page_layout a on a.id=l.first_slot_id
    join app.page_layout b on b.id=l.last_slot_id where l.id=owner and a.sort_order>b.sort_order)
  then raise exception 'Reversed repeat bounds' using errcode='23514'; end if;
  return null;
end $$;
create constraint trigger repeat_layout_bounds after update of first_slot_id,last_slot_id on app.layouts
  deferrable initially deferred for each row execute function app.check_repeat_bounds();
create constraint trigger repeat_slot_bounds after update of sort_order on app.page_layout
  deferrable initially deferred for each row execute function app.check_repeat_bounds();

grant update(source_type_id,filter_type_id,filter_text,repeat_mode,first_slot_id,last_slot_id) on app.layouts to app_api;
