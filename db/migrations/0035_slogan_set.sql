-- Девиз — свой набор, подключаемый к любой записи.
--
-- Решение пользователя 2026-10-09: четыре величины девиза (девиз, девиз на
-- языке оригинала, язык, источник) жили в «Что — основные сведения» и
-- подсказывались каждому зданию, книге и фильму, хотя не заполнены ни у одной
-- записи. Они выделены в предметный набор «Девиз»: как «Большепролётное
-- покрытие», он подключается к записи по отдельности — манифесту, школе,
-- выставке, зданию — из любой ветви. Значений девиза в базе нет, переносить
-- нечего.
insert into app.parameter_sets (code, title_ru, note, sort_order) values
  ('slogan', 'Девиз', 'Девиз записи, на языке оригинала, его язык и источник. Подключается к записи по отдельности.', 120);

update app.parameter_set_items psi
   set set_id = (select id from app.parameter_sets where code = 'slogan')
 where psi.set_id = (select id from app.parameter_sets where code = 'what_basic')
   and psi.parameter_id in (select id from app.parameters
                             where code in ('slogan', 'slogan_original', 'slogan_language', 'slogan_source_url'));
