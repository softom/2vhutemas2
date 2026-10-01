-- Карточка книги, статьи и веб-страницы показывает их изображения и связи.
--
-- В 0026 карточке источника достались только показатели, текст, упоминания
-- и «как цитировать». Но у книги бывает обложка, разворот, иллюстрация, а
-- автор книги — связь: связи «иллюстрация» и «автор» были, а на странице их
-- не было видно (замечание пользователя 2026-10-01, книга «Урбанизм»).
-- Разделы встают в том же порядке, что у остальных записей: показатели,
-- связи, текст, изображения.
insert into app.type_presentation_items (presentation_id, component, sort_order, link_role_id)
select tp.id, x.component, x.sort,
       case when x.component = 'gallery' then (select id from app.link_roles where code = 'illustration') end
  from app.type_presentations tp
  join app.entity_types t on t.id = tp.type_id
  join (values ('links', 15), ('gallery', 25)) as x(component, sort) on true
 where tp.mode = 'card' and t.code in ('book', 'article', 'web_page')
   and not exists (select 1 from app.type_presentation_items i
                    where i.presentation_id = tp.id and i.component = x.component);
