-- 0012: адрес места по элементам, без дублей.
--
-- Разбор с пользователем 2026-09-23. В записи места было три способа сказать
-- одно и то же: название места, адрес одной строкой и элементы адреса.
--
-- Что убирается и почему:
--   * `title` — придумано исполнителем. Если у места есть имя, это имя объекта
--     («Новосибирский оперный театр»), а объект у нас уже существует со своим
--     названием. Для положения на карте имя не нужно;
--   * `address_line` — адрес одной строкой повторяет элементы. Раз адрес
--     спрашивается по элементам, строка не нужна.
--
-- Остаются элементы адреса в обычном порядке: страна, населённый пункт,
-- улица, дом, помещение. Подпись для показа собирается из них, а не хранится.

alter table app.places add column if not exists street text;
alter table app.places add column if not exists house  text;
alter table app.places add column if not exists unit   text;

comment on column app.places.street is 'Улица, проспект, площадь';
comment on column app.places.house is 'Дом, корпус, строение';
comment on column app.places.unit is 'Квартира, офис, помещение';

-- Сохраняем то, что уже введено: строка адреса переносится в улицу целиком.
-- Разобрать её на элементы автоматически нельзя, поэтому запись останется
-- на доработку редактором — придумывать разбор за автора мы не будем.
update app.places
   set street = coalesce(street, address_line)
 where address_line is not null;

alter table app.places drop column if exists address_line;
alter table app.places drop column if exists title;

-- Пустая запись места по-прежнему не создаётся: должно быть заполнено
-- хоть что-то из адреса или координат.
alter table app.places add constraint places_not_empty_chk check (
    num_nonnulls(country, settlement, street, house, unit) > 0 or lat is not null
);
