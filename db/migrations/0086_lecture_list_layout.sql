-- List data remains in the existing ordered lecture catalogue.
do $$
declare
 page_uid constant uuid := '39ee9267-1a0e-4928-b608-24bf91f68104';
 layout_uid uuid;
begin
 insert into app.widgets(name,renderer_key) values('Список лекций','lecture_list')
 on conflict(renderer_key) do nothing;
 insert into app.layouts(page_id,name,grid_columns) values(page_uid,'Лекции · список по номерам',4) returning id into layout_uid;
 insert into app.page_layout(layout_id,widget_id,sort_order,row_start,column_start,column_span,row_span)
 select layout_uid,w.id,n,n,c,width,1 from (values
   (1,'site_menu',1,4),(2,'lecture_list',2,2),(3,'site_footer',1,4)
 ) s(n,k,c,width) join app.widgets w on w.renderer_key=s.k;
 if (select count(*) from app.page_layout where layout_id=layout_uid)<>3 then raise exception 'Incomplete lecture layout';end if;
end $$;
