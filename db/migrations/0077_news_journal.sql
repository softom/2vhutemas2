-- Add the news source without relying on a type UUID shared between installations.
do $$
declare
  news_type uuid;
  page_uid constant uuid := '39ee9267-1a0e-4928-b608-24bf91f68105';
  layout_uid uuid;
  widget_uid uuid;
  first_uid uuid;
  last_uid uuid;
begin
  select id into strict news_type from app.entity_types where code='news';
  alter table app.layouts drop constraint layouts_check;
  execute format($check$alter table app.layouts add constraint layouts_check check (
    (repeat_mode is null and num_nonnulls(source_type_id,filter_type_id,filter_text,first_slot_id,last_slot_id)=0)
    or (repeat_mode is not null and num_nonnulls(source_type_id,first_slot_id,last_slot_id)=3 and (
      (page_id,source_type_id) in (
        ('39ee9267-1a0e-4928-b608-24bf91f68102'::uuid,'00000000-0000-4000-a000-0000000000e2'::uuid),
        ('39ee9267-1a0e-4928-b608-24bf91f68103'::uuid,'00000000-0000-4000-a000-0000000000e1'::uuid))
      or (page_id=%L and source_type_id=%L and repeat_mode='journal'))))$check$,page_uid,news_type);
  insert into app.widgets(name,renderer_key) values('Плашка новости','news_compact') on conflict(renderer_key) do nothing;
  select id into strict widget_uid from app.widgets where renderer_key='news_compact';
  insert into app.layouts(page_id,name,grid_columns) values(page_uid,'Новости · журнальная мозаика',4) returning id into layout_uid;
  insert into app.page_layout(layout_id,widget_id,sort_order,row_start,column_start,row_span,column_span,design,call_params)
  select layout_uid,widget_uid,n,r,c,h,w,d,'{"entity_id":{"alias":".this"}}'::jsonb
  from (values (1,1,2,1,2,'regular'),(2,2,2,1,2,'regular'),(3,3,1,2,2,'feature'),
               (4,3,3,1,1,'compact'),(5,4,3,1,1,'compact')) slots(n,r,c,h,w,d);
  select id into first_uid from app.page_layout where layout_id=layout_uid and sort_order=1;
  select id into last_uid from app.page_layout where layout_id=layout_uid and sort_order=5;
  update app.layouts set repeat_mode='journal',source_type_id=news_type,first_slot_id=first_uid,last_slot_id=last_uid where id=layout_uid;
end $$;
