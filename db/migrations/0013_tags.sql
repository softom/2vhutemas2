-- 0013: метки — общий справочник слов для всех записей.
--
-- Решение пользователя 2026-09-23: ключевые слова нужны не только файлам,
-- а всем объектам системы. Ввод по «#»: список стандартных слов сужается
-- по мере набора, выбранное берётся из справочника, новое его пополняет.
--
-- Почему справочник, а не строка в каждой записи: свободный текст неизбежно
-- разводит «Сиань» и «сиань», «Модернизм» и «модернизм», и отбор по метке
-- начинает врать. Единый список этого не допускает.
--
-- Метка не заменяет связь с периодом и не заменяет тип объекта: это слово
-- для поиска и группировки, а не утверждение об объекте.

create table app.tags (
    id          uuid primary key default gen_random_uuid(),
    title       text not null,
    created_at  timestamptz not null default now(),
    created_by  uuid,
    constraint tags_title_not_empty_chk check (btrim(title) <> '')
);

comment on table app.tags is
    'Общий справочник меток. Написание хранится как введено впервые, повторы по регистру и пробелам не допускаются.';

create unique index tags_title_uniq on app.tags (lower(btrim(title)));
create index tags_title_search_idx on app.tags (lower(title) text_pattern_ops);

create table app.entity_tags (
    entity_id  bigint not null references app.entities(id) on delete cascade,
    tag_id     uuid   not null references app.tags(id) on delete cascade,
    primary key (entity_id, tag_id)
);

create table app.media_tags (
    asset_id  uuid not null references app.media_assets(id) on delete cascade,
    tag_id    uuid not null references app.tags(id) on delete cascade,
    primary key (asset_id, tag_id)
);

create index entity_tags_tag_idx on app.entity_tags(tag_id);
create index media_tags_tag_idx  on app.media_tags(tag_id);

-- Перенос ключевых слов файлов в общий справочник: набранное не теряем.
with words as (
    select distinct btrim(word) as title
    from app.media_assets, unnest(keywords) as word
    where btrim(word) <> ''
)
insert into app.tags (title)
select title from words
on conflict do nothing;

insert into app.media_tags (asset_id, tag_id)
select a.id, t.id
from app.media_assets a, unnest(a.keywords) as word
join app.tags t on lower(btrim(t.title)) = lower(btrim(word))
on conflict do nothing;

alter table app.media_assets drop column if exists keywords;
