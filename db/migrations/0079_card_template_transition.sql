-- Old versions retain their original rendering until their explicit successor is assigned.
alter table app.layouts add column explicit_card_slots boolean not null default false;
alter table app.layouts alter column explicit_card_slots set default true;

alter table app.page_layout drop constraint page_layout_check1;
alter table app.page_layout add constraint frame_shape check (
 widget_id not in ('3914f3f7-9447-43e8-a7b1-d7888d6adb91','f48ef78d-943c-4594-ac15-c6476193faee')
 or (column_start=1 and column_span in (3,4) and row_span=1));

create function app.frame_full_width() returns trigger language plpgsql as $$
begin
 if new.widget_id in ('3914f3f7-9447-43e8-a7b1-d7888d6adb91','f48ef78d-943c-4594-ac15-c6476193faee')
 and new.column_span<>(select grid_columns from app.layouts where id=new.layout_id) then
  raise exception 'Frame must span the layout' using errcode='23514';
 end if;
 return new;
end $$;
create trigger frame_full_width before insert or update of widget_id,column_span,layout_id on app.page_layout
for each row execute function app.frame_full_width();
