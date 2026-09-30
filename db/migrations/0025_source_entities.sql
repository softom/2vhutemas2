-- Цитируемое — объект, обстоятельства цитаты — связь (Р-76, уточнение
-- пользователя 2026-09-30).
--
-- «Камю в статье о Прекрасном на стр. 34 говорил „…“» — здесь статья это
-- сущность, а вся остальная фраза принадлежит связи: она и есть основание
-- конкретного использования. Один и тот же источник цитируется многими
-- связями с разными страницами, и копия источника для этого не нужна.
--
-- Книга и статья в дереве уже есть; не хватало веб-страницы, её адреса и
-- роли связи. Прежний механизм источников (`reference_items`) эта миграция
-- не трогает: он пуст, снимать его отдельным шагом.

-- Веб-страница — такой же объект ветви «Что», как книга и статья: у неё есть
-- название, собственный текст и сведения. Ставим рядом со статьёй.
insert into app.entity_types (parent_id, code, title_ru, sort_order)
select id, 'web_page', 'Веб-страница', 95 from app.entity_types where code = 'what';

-- Адрес страницы — сведение объекта, а не связи: он один и тот же, из какого
-- бы текста на неё ни ссылались.
insert into app.parameters (code, title_ru, value_type, definition, sort_order)
values ('url', 'Адрес страницы', 'text',
        'Точный адрес цитируемой страницы. Страница, абзац и сама цитата к адресу не относятся: они принадлежат связи.',
        10);

insert into app.parameter_sets (code, title_ru, note, sort_order)
values ('source_page', 'Веб-страница — адрес',
        'Минимум, без которого ссылка не источник, а название.', 40);

insert into app.parameter_set_items (set_id, parameter_id, sort_order)
select s.id, p.id, 10
  from app.parameter_sets s, app.parameters p
 where s.code = 'source_page' and p.code = 'url';

insert into app.type_parameter_sets (type_id, set_id)
select t.id, s.id
  from app.entity_types t, app.parameter_sets s
 where t.code = 'web_page' and s.code = 'source_page';

-- Роль связи: чем является объект для текста. Обоснование этой связи и есть
-- «где именно и что именно сказано».
insert into app.link_roles (code, title_ru, sort_order)
values ('source', 'Источник', 90);
