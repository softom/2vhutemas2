-- Классификатор помещений: поправки коллеги, переданные пользователем 2026-10-14.
--
-- Ложи — места, с которых смотрят событие (берлинское задание: «200 мест в
-- ложах», 600 м²), то есть зона 2; клуб и лаунж гостей — зона 3.
-- Переговорная событием не является: это работа — зона 1 офиса; в зоне 2
-- остаются залы собраний и конференц-залы. Значений с этими узлами в базе нет.
insert into app.parameter_options (parameter_id, code, title_ru, sort_order, parent_id)
select p.id, x.code, x.title, x.sort,
       (select o.id from app.parameter_options o where o.parameter_id = p.id and o.code = x.parent)
  from app.parameters p,
       (values ('users.boxes', 'Ложи', 'users', 15),
               ('core.meeting', 'Переговорные', 'core', 25)) as x(code, title, parent, sort)
 where p.code = 'program_purpose';

update app.parameter_options o set title_ru = x.title
  from (values ('visitors.hospitality', 'Гостевая зона: клуб, лаунж'),
               ('users.meeting', 'Залы собраний, конференц-залы')) as x(code, title)
 where o.code = x.code and o.parameter_id = (select id from app.parameters where code = 'program_purpose');
