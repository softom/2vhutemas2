-- Вариант изображения «page» — для показа в колонке страницы (0053).
--
-- Замечание пользователя 2026-10-24: на странице конкурса Лимасола
-- изображения грузились «со скоростью черепахи». Страница показывала
-- экранный вариант (до 2560 px, 0,4–0,8 МБ) в колонке шириной ~550 px.
-- «page» — до 1400 px по длинной стороне (колонка с запасом на плотные
-- экраны); «screen» остаётся для просмотра на весь экран. Существующим
-- файлам вариант создаётся при первом запросе.

alter table app.media_files drop constraint media_files_variant_check;
alter table app.media_files add constraint media_files_variant_check
  check (variant = any (array['original'::text, 'screen'::text, 'page'::text, 'thumbnail'::text]));
