-- Площадная программа — свой раздел страницы записи, сразу под «Связями».
--
-- Решение пользователя 2026-10-14: «представление этих данных на странице
-- сущности … под связями, и открываться по уровням». Порядок разделов карточки
-- задаёт таблица отображений: новый компонент program встаёт за links во всех
-- настройках карточки, где связи есть. Раздел пуст — его нет на странице.
alter table app.type_presentation_items drop constraint type_presentation_items_component_check;
alter table app.type_presentation_items add constraint type_presentation_items_component_check
  check (component in (
    'title', 'thumbnail', 'portrait', 'mark', 'parameter',
    'indicators', 'links', 'text', 'gallery', 'sources', 'mentions', 'citation',
    'tags', 'video', 'program'));

insert into app.type_presentation_items (presentation_id, component, sort_order)
select i.presentation_id, 'program', i.sort_order + 2
  from app.type_presentation_items i
  join app.type_presentations tp on tp.id = i.presentation_id and tp.mode = 'card'
 where i.component = 'links'
   and not exists (select 1 from app.type_presentation_items x
                    where x.presentation_id = i.presentation_id and x.component = 'program');
