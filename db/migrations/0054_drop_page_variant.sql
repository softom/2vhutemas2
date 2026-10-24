-- Откат варианта «page» (0053): у изображений три варианта.
--
-- Пользователь 2026-10-24: все изображения проходят через обработчик сайта,
-- и он делает три размера — original, screen, thumbnail; отдельный вариант
-- «page» с созданием при первом запросе — нарушение этой логики. Скорость
-- страниц решается параметром того же обработчика: длинная сторона screen
-- 2560 → 1600 px (рецепт v2), screen пересоздаётся маршрутом повторной
-- обработки. Производные «page» — воспроизводимые файлы; строки удаляются,
-- файлы derived/*/page-*.webp убираются с диска при выкладке.

delete from app.media_files where variant = 'page';
alter table app.media_files drop constraint media_files_variant_check;
alter table app.media_files add constraint media_files_variant_check
  check (variant = any (array['original'::text, 'screen'::text, 'thumbnail'::text]));
