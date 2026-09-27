-- 0023: страницы самого проекта входят в общее дерево сущностей.
-- Их текст, версии, авторство и публикация остаются в стандартной модели.
insert into app.entity_types (id, parent_id, code, title_ru, sort_order)
values ('00000000-0000-4000-a000-0000000000e5', null, 'project_pages', 'Страницы проекта', 50);

insert into app.entity_types (parent_id, code, title_ru, sort_order)
values
  ('00000000-0000-4000-a000-0000000000e5', 'about_logo', 'Логотип', 10),
  ('00000000-0000-4000-a000-0000000000e5', 'about_philosophy', 'Философия', 20),
  ('00000000-0000-4000-a000-0000000000e5', 'about_manifest', 'Манифест', 30),
  ('00000000-0000-4000-a000-0000000000e5', 'about_feedback', 'Обратная связь', 40);
