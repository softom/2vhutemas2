-- 0014: место не заводится дважды.
--
-- Наблюдение пользователя 2026-09-23: в справочнике оказалось три записи
-- «Россия, Новосибирск, Красный проспект, 36» и по две «Китай, Сиань».
-- Создание места не проверяло, нет ли такого же — а место универсальный
-- элемент, и смысл его в переиспользовании.
--
-- Совпадением считается одинаковый адрес без учёта регистра и лишних
-- пробелов. Записи без адреса, заданные только координатами, этим правилом
-- не охватываются: у них нет надёжного признака тождества.

-- 1. Сводим накопленные повторы: оставляем самую раннюю запись группы.
create temporary table place_merge as
select p.id,
       first_value(p.id) over (
         partition by lower(btrim(coalesce(p.country, ''))),
                      lower(btrim(coalesce(p.settlement, ''))),
                      lower(btrim(coalesce(p.street, ''))),
                      lower(btrim(coalesce(p.house, ''))),
                      lower(btrim(coalesce(p.unit, '')))
         order by p.created_at, p.id
       ) as keep_id
from app.places p
where coalesce(p.country, p.settlement, p.street, p.house, p.unit) is not null;

-- Координаты не теряем: если у оставляемой записи их нет, а у повтора есть.
update app.places keep
   set lat = coalesce(keep.lat, source.lat),
       lon = coalesce(keep.lon, source.lon),
       precision = case when keep.lat is null and source.lat is not null
                        then source.precision else keep.precision end
  from place_merge m
  join app.places source on source.id = m.id
 where keep.id = m.keep_id and m.id <> m.keep_id;

-- Если к одной цели уже прикреплено оставляемое место с той же ролью,
-- повторную привязку не переносим, а убираем: она была тем же самым.
delete from app.attachments a
 using place_merge m
 where a.place_id = m.id and m.id <> m.keep_id
   and exists (
     select 1 from app.attachments other
      where other.target_id = a.target_id and other.role_id = a.role_id
        and other.place_id = m.keep_id);

update app.attachments a
   set place_id = m.keep_id
  from place_merge m
 where a.place_id = m.id and m.id <> m.keep_id;

delete from app.places p using place_merge m where p.id = m.id and m.id <> m.keep_id;

-- 2. Впредь повтор адреса невозможен на уровне базы.
create unique index places_address_uniq on app.places (
    lower(btrim(coalesce(country, ''))),
    lower(btrim(coalesce(settlement, ''))),
    lower(btrim(coalesce(street, ''))),
    lower(btrim(coalesce(house, ''))),
    lower(btrim(coalesce(unit, '')))
) where coalesce(country, settlement, street, house, unit) is not null;

comment on index app.places_address_uniq is
    'Одинаковый адрес не заводится дважды: место переиспользуется, а не копируется.';
