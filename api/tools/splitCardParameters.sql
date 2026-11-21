-- Invoke with psql -v actor=<confirmed contributor UID> -v ON_ERROR_STOP=1.
begin;
set local role app_api;
select set_config('app.contributor_id', :'actor', true);
select pg_advisory_xact_lock(hashtextextended('card-layout-migration',0));
do $$
declare
  p record; slot record; draft uuid; shift_rows integer;
  param_row integer; param_order integer; n integer;
begin
  if not exists (select 1 from app.contributors c join app.user_roles u on u.contributor_id=c.id
    join app.role_permissions rp on rp.role_id=u.role_id join app.permissions perm on perm.id=rp.permission_id
    where c.id=current_setting('app.contributor_id')::uuid and c.status='active' and u.revoked_at is null and perm.action='su')
  then raise exception 'Active su contributor required'; end if;
  for p in select tp.id,tp.layout_id,l.name,l.page_id from app.type_presentations tp
    join app.layouts l on l.id=tp.layout_id where tp.mode='card' order by tp.id for update of tp
  loop
    select count(*),min(s.row_start),min(s.sort_order) into n,param_row,param_order
      from app.page_layout s join app.widgets w on w.id=s.widget_id
      where s.layout_id=p.layout_id and w.renderer_key='parameters';
    if n=2 and (select count(distinct s.column_start) from app.page_layout s join app.widgets w on w.id=s.widget_id
      where s.layout_id=p.layout_id and w.renderer_key='parameters' and (s.column_start,s.column_span) in ((1,2),(3,1)))=2 then continue; end if;
    if n<>1 or param_row<>1 or exists(select 1 from app.page_layout where layout_id=p.layout_id and sort_order<=param_order and row_span<>1)
    then raise exception 'Unexpected source geometry in %',p.layout_id; end if;
    select case when exists(select 1 from app.page_layout where layout_id=p.layout_id and row_start=param_row and sort_order<>param_order) then 1 else 0 end into shift_rows;
    insert into app.layouts(page_id,name) values(p.page_id,p.name || ' · параметры по сторонам') returning id into draft;
    for slot in select * from app.page_layout where layout_id=p.layout_id order by sort_order loop
      if slot.sort_order=param_order then
        insert into app.page_layout(layout_id,widget_id,sort_order,row_start,column_start,row_span,column_span,design)
        values(draft,slot.widget_id,param_order,param_row,1,1,2,slot.design),
              (draft,slot.widget_id,param_order+1,param_row,3,1,1,slot.design);
      else
        insert into app.page_layout(layout_id,widget_id,sort_order,row_start,column_start,row_span,column_span,design)
        values(draft,slot.widget_id,slot.sort_order+case when slot.sort_order>param_order then 1 else 0 end,
          slot.row_start+shift_rows,slot.column_start,slot.row_span,slot.column_span,slot.design);
      end if;
    end loop;
    update app.type_presentations set layout_id=draft, settings=jsonb_set(coalesce(settings,'{}'::jsonb),
      '{prepared_card_layout_id}',to_jsonb(draft)) where id=p.id;
  end loop;
end $$;
commit;
