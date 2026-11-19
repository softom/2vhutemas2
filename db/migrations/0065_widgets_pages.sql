-- Page versions are immutable after their first assignment.
create extension if not exists btree_gist;
create table app.pages (
 id uuid primary key default gen_random_uuid(),
 name text not null check (btrim(name)<>''),
 description text, current_layout_id uuid
);
create table app.widgets (
 id uuid primary key default gen_random_uuid(),
 name text not null check (btrim(name)<>''),
 renderer_key text not null unique check(renderer_key ~ '^[a-z][a-z0-9_]*$')
);
create table app.layouts (
 id uuid primary key default gen_random_uuid(),
 page_id uuid not null references app.pages(id) on delete restrict,
 name text not null check(btrim(name)<>''),
 revision integer not null default 0,
 assigned boolean not null default false,
 unique(page_id,id)
);
alter table app.pages add foreign key(id,current_layout_id) references app.layouts(page_id,id) on delete restrict;
alter table app.type_presentations add column layout_id uuid references app.layouts(id) on delete restrict,
 add check(layout_id is null or mode='card');
create table app.page_layout (
 id uuid primary key default gen_random_uuid(),
 layout_id uuid not null references app.layouts(id) on delete restrict,
 widget_id uuid not null references app.widgets(id) on delete restrict,
 sort_order integer not null,
 row_start integer not null check(row_start>=1),
 column_start integer not null check(column_start between 1 and 3),
 row_span integer not null check(row_span>=1),
 column_span integer not null check(column_span between 1 and 4-column_start),
 design text,
 unique(layout_id,sort_order) deferrable initially deferred,
 exclude using gist (layout_id with =,
   int8range(row_start::bigint,row_start::bigint+row_span) with &&,
   int4range(column_start,column_start+column_span) with &&) deferrable initially deferred
);
create table app.audit_log (
 id uuid primary key default gen_random_uuid(), occurred_at timestamptz not null default clock_timestamp(),
 contributor_id uuid references app.contributors(id), event text not null, object_id uuid not null,
 before_value jsonb, after_value jsonb
);
create index audit_log_object_time on app.audit_log(object_id,occurred_at);
create function app.layout_event() returns trigger language plpgsql security definer
set search_path=pg_catalog,app as $$
declare prior jsonb; following jsonb;
begin
 if tg_op<>'INSERT' then prior:=to_jsonb(old); end if;
 if tg_op<>'DELETE' then following:=to_jsonb(new); end if;
 insert into app.audit_log(contributor_id,event,object_id,before_value,after_value)
 values(nullif(current_setting('app.contributor_id',true),'')::uuid,tg_argv[0],
 coalesce(following->>'id',prior->>'id')::uuid,prior,following);
 return null;
end $$;
create trigger widget_event after insert on app.widgets for each row execute function app.layout_event('widget_created');
create trigger layout_event after insert on app.layouts for each row execute function app.layout_event('layout_created');
create trigger slot_event after insert or update or delete on app.page_layout for each row execute function app.layout_event('page_layout_updated');
create trigger page_assignment_event after update of current_layout_id on app.pages for each row
 when(old.current_layout_id is distinct from new.current_layout_id) execute function app.layout_event('layout_assigned');
create trigger type_assignment_event after update of layout_id on app.type_presentations for each row
 when(old.layout_id is distinct from new.layout_id) execute function app.layout_event('layout_assigned');
create trigger type_first_assignment after insert on app.type_presentations for each row
 when(new.layout_id is not null) execute function app.layout_event('layout_assigned');

create function app.lock_assigned_layout() returns trigger language plpgsql security definer
set search_path=pg_catalog,app as $$
declare target uuid; owner_page uuid;
begin
 if tg_table_name='pages' then target:=new.current_layout_id; owner_page:=new.id;
 else target:=new.layout_id; owner_page:='39ee9267-1a0e-4928-b608-24bf91f68101'; end if;
 if target is not null then
  update app.layouts set assigned=true where id=target and page_id=owner_page;
  if not found then raise exception 'Layout belongs to a different page' using errcode='23503'; end if;
 end if;
 return new;
end $$;
create trigger assign_page before insert or update of current_layout_id on app.pages for each row execute function app.lock_assigned_layout();
create trigger assign_type before insert or update of layout_id on app.type_presentations for each row execute function app.lock_assigned_layout();

create function app.touch_layout_for_slot() returns trigger language plpgsql security definer
set search_path=pg_catalog,app as $$
declare target uuid;
begin
 if tg_op='UPDATE' and new.layout_id<>old.layout_id then raise exception 'Cannot move a slot between layouts' using errcode='23514'; end if;
 if tg_op='DELETE' then target:=old.layout_id; else target:=new.layout_id; end if;
 update app.layouts set revision=revision+1 where id=target and not assigned;
 if not found then raise exception 'Layout is absent or immutable' using errcode='23514'; end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger touch_slot before insert or update or delete on app.page_layout for each row execute function app.touch_layout_for_slot();

insert into app.pages(id,name) values
 ('39ee9267-1a0e-4928-b608-24bf91f68101','Карточка сущности'),
 ('39ee9267-1a0e-4928-b608-24bf91f68102','Проекты'),
 ('39ee9267-1a0e-4928-b608-24bf91f68103','Авторы'),
 ('39ee9267-1a0e-4928-b608-24bf91f68104','Лекции'),
 ('39ee9267-1a0e-4928-b608-24bf91f68105','Новости'),
 ('39ee9267-1a0e-4928-b608-24bf91f68106','О проекте');
insert into app.widgets(id,name,renderer_key) values
 ('742ef66f-a8a2-442f-8083-65c9672687b2','Стилистический анализ','style_analysis');
-- Override the broad default grants for new tables in schema app.
revoke all on app.pages,app.widgets,app.layouts,app.page_layout,app.audit_log from public,app_api;
grant select on app.pages,app.widgets,app.layouts,app.page_layout to app_api;
grant insert(name,renderer_key) on app.widgets to app_api;
grant insert(page_id,name) on app.layouts to app_api;
grant update(current_layout_id) on app.pages to app_api;
grant insert,update,delete on app.page_layout to app_api;
-- A type can override its card layout while retaining the inherited list of sections.
alter table app.type_presentations add column layout_only boolean not null default false;
create or replace function app.presentation_for(p_type uuid,p_mode text) returns uuid language sql stable as $$
 with recursive up as (
  select id,parent_id,0 as distance from app.entity_types where id=p_type
  union all select t.id,t.parent_id,u.distance+1 from app.entity_types t join up u on u.parent_id=t.id
 ) select p.id from up join app.type_presentations p on p.type_id=up.id
 where p.mode=p_mode and not p.layout_only order by distance limit 1
$$;
create function app.protect_layout_version() returns trigger language plpgsql as $$
begin
 if old.assigned and (tg_op='DELETE' or new is distinct from old) then
  raise exception 'Assigned layout is immutable' using errcode='23514';
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
create trigger protect_layout before update or delete on app.layouts for each row execute function app.protect_layout_version();
grant update(name) on app.layouts to app_api;
