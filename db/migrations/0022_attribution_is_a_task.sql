-- Ссылки на автора и источник — внутренняя задача, а не запрет (Р-68).
--
-- Решение пользователя 2026-09-27, отменяет часть [0021]: «Давай ослабим
-- правило. Важна целостность сайта. Цитирование поставим внутренней задачей».
--
-- Миграция 0021 закрыла от посторонних 131 файл, у которых нечем подписать
-- автора и источник, — и сайт вышел дырявым: у половины карточек пропала
-- обложка. Целостность показа оказалась важнее строгости правила: ссылки
-- проставляются по ходу работы, а не служат воротами на публикацию.
--
-- Возвращаем публичность тем и только тем файлам, которых коснулась 0021:
-- условие здесь то же, поэтому файл, закрытый редактором по другой причине,
-- останется закрытым.

begin;

-- Одно определение «ссылок не хватает» на всю систему: его спрашивают и
-- список медиатеки, и отбор задачи, и счётчик. Держать это условие в трёх
-- запросах значит однажды поправить два из них.
create or replace function app.media_needs_attribution(a app.media_assets)
returns boolean language sql immutable as $$
  select not (coalesce(nullif(a.author, ''), nullif(a.credit, '')) is not null
          and coalesce(nullif(a.source_url, ''), nullif(a.original_caption, ''),
                       nullif(a.holder, '')) is not null)
$$;

comment on function app.media_needs_attribution(app.media_assets) is
  'Файл ждёт ссылок: не указано, кому приписать или откуда взято (Р-68)';

update app.media_assets
   set visibility = 'public',
       updated_at = now()
 where archived_at is null
   and visibility = 'private'
   and not (coalesce(nullif(author, ''), nullif(credit, '')) is not null
        and coalesce(nullif(source_url, ''), nullif(original_caption, ''),
                     nullif(holder, '')) is not null);

commit;
