-- Existing layouts and older API clients retain three columns.
alter table app.layouts
  add column grid_columns smallint not null default 3 check (grid_columns in (3, 4));
grant insert(grid_columns) on app.layouts to app_api;

alter table app.page_layout
  drop constraint page_layout_check,
  drop constraint page_layout_column_start_check,
  add check (column_start between 1 and 4),
  add check (column_span between 1 and 5 - column_start);

-- The format belongs to the version. Changing it requires a new layout.
create function app.keep_grid_columns() returns trigger language plpgsql as $$
begin
  if new.grid_columns <> old.grid_columns then
    raise exception 'Grid size is immutable' using errcode='23514';
  end if;
  return new;
end $$;
create trigger keep_grid_columns before update of grid_columns on app.layouts
  for each row execute function app.keep_grid_columns();

create function app.check_slot_grid() returns trigger language plpgsql as $$
begin
  if new.column_span::bigint + new.column_start - 1 >
     (select grid_columns from app.layouts where id = new.layout_id) then
    raise exception 'Slot exceeds layout grid' using errcode='23514';
  end if;
  return new;
end $$;
create trigger check_slot_grid before insert or update of column_start,column_span,layout_id
  on app.page_layout for each row execute function app.check_slot_grid();
