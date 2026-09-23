-- 0011: места.
--
-- Решение Р-25: место — отдельная справочная запись, её назначение —
-- положение на карте. Истории названий и вариантов написания нет.
--
-- Роль принадлежит привязке, а не месту: одна и та же запись может быть
-- адресом здания, местом рождения человека, его захоронением и офисом бюро.
-- Поэтому место становится четвёртым видом содержимого вложения, наряду
-- с документом, медиа и источником, а роль берётся из общего словаря ролей.
--
-- Колонки city, country и address из профиля объекта удаляются: два источника
-- одного сведения недопустимы. Заполненные значения переносятся в места
-- и привязываются к своим объектам до удаления колонок.

create table app.places (
    id           uuid primary key default gen_random_uuid(),
    title        text not null,
    address_line text,
    settlement   text,
    country      text,
    lat          double precision check (lat between -90 and 90),
    lon          double precision check (lon between -180 and 180),
    precision    text not null default 'settlement'
                 check (precision in ('point', 'building', 'settlement', 'region')),
    source_url   text,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    created_by   uuid,
    updated_by   uuid,
    constraint places_coords_together_chk check ((lat is null) = (lon is null))
);

comment on table app.places is
    'Места: положение на карте. Одно место переиспользуется многими объектами; смысл привязки задаёт её роль.';
comment on column app.places.precision is
    'Уровень точности: точка, здание, населённый пункт, область. Без него нельзя честно показать место на карте';
comment on column app.places.title is 'Как место называется: «Сиань», «Новосибирский оперный театр»';

create index places_settlement_idx on app.places(settlement);
create index places_country_idx    on app.places(country);
create index places_coords_idx     on app.places(lat, lon) where lat is not null;

create trigger places_audit_trg
    before insert or update on app.places
    for each row execute function app.tg_set_audit();

-- Роли привязки места. Состав — по названным пользователем случаям.
insert into app.attachment_roles (code, title_ru, sort_order) values
    ('address',    'Адрес объекта',     200),
    ('birthplace', 'Место рождения',    210),
    ('burial',     'Захоронение',       220),
    ('office',     'Офис организации',  230)
on conflict (code) do nothing;

-- Место как содержимое вложения: взаимоисключающее с остальными видами.
alter table app.attachments add column if not exists place_id uuid references app.places(id) on delete cascade;

alter table app.attachments drop constraint if exists attachments_one_content_chk;
alter table app.attachments add constraint attachments_one_content_chk
    check (num_nonnulls(document_id, asset_id, reference_item_id, place_id) = 1);

create unique index attachments_uniq_place
    on app.attachments(target_id, place_id, role_id) where place_id is not null;
create index attachments_place_idx on app.attachments(place_id);

-- Перенос заполненных значений из профиля объекта.
-- Пустые сведения записи не создают: нет данных — нет места и нет привязки.
with filled as (
    select op.entity_id, op.city, op.country, op.address
    from app.object_profile op
    where coalesce(op.city, op.country, op.address) is not null
), created as (
    insert into app.places (title, address_line, settlement, country, precision)
    select coalesce(f.address, f.city, f.country),
           f.address, f.city, f.country,
           case when f.address is not null then 'building'
                when f.city is not null then 'settlement'
                else 'region' end
    from filled f
    returning id, address_line, settlement, country
)
insert into app.attachments (target_id, role_id, place_id)
select t.id,
       (select id from app.attachment_roles where code = 'address'),
       c.id
from filled f
join created c
  on c.address_line is not distinct from f.address
 and c.settlement   is not distinct from f.city
 and c.country      is not distinct from f.country
join app.targets t on t.entity_id = f.entity_id;

alter table app.object_profile
    drop column if exists city,
    drop column if exists country,
    drop column if exists address;
