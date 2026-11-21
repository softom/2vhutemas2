insert into app.widgets(id,name,renderer_key) values
 ('3914f3f7-9447-43e8-a7b1-d7888d6adb91','МЕНЮ','site_menu'),
 ('f48ef78d-943c-4594-ac15-c6476193faee','Подвал','site_footer');

create unique index page_frame_widget_once on app.page_layout(layout_id,widget_id)
 where widget_id in ('3914f3f7-9447-43e8-a7b1-d7888d6adb91','f48ef78d-943c-4594-ac15-c6476193faee');
alter table app.page_layout add check (
 widget_id not in ('3914f3f7-9447-43e8-a7b1-d7888d6adb91','f48ef78d-943c-4594-ac15-c6476193faee')
 or (column_start=1 and column_span=4 and row_span=1));
