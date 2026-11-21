-- Согласовано 21.11.2026. Самостоятельная запись в ветви «Что».
insert into app.entity_types(parent_id,code,title_ru,sort_order)
values ((select id from app.entity_types where code='what'),'quotation','Цитата',90);

insert into app.parameters(code,title_ru,value_type,sort_order) values
('quotation_context','Контекст','blocks',10),
('quotation_original','Оригинал','text',20),
('quotation_language','Язык оригинала','option',30),
('quotation_year','Год высказывания','date',40),
('quotation_reliability','Надёжность','option',50);

insert into app.parameter_options(parameter_id,code,title_ru,sort_order)
select p.id,v.code,v.title,v.ord from (values
('quotation_language','en','Английский',10),('quotation_language','ru','Русский',20),
('quotation_language','fr','Французский',30),('quotation_language','ca','Каталанский',40),
('quotation_reliability','authored','Авторский текст',10),
('quotation_reliability','recorded','Записано учениками',20),
('quotation_reliability','attributed','Приписывается',30),
('quotation_reliability','unconfirmed','Не подтверждено',40)
) v(param,code,title,ord) join app.parameters p on p.code=v.param;

insert into app.parameter_sets(code,title_ru,note) values
('quotation_details','Цитата','Русский перевод, контекст, оригинал и атрибуция. Источник указывается связью.');

insert into app.parameter_set_items(set_id,parameter_id,sort_order,is_required)
select s.id,p.id,v.ord,v.required from (values
('text',0,true),('quotation_context',10,true),('quotation_original',20,false),
('quotation_language',30,false),('quotation_year',40,false),('quotation_reliability',50,false)
) v(code,ord,required) join app.parameters p on p.code=v.code
cross join app.parameter_sets s where s.code='quotation_details';

insert into app.type_parameter_sets(type_id,set_id)
select t.id,s.id from app.entity_types t cross join app.parameter_sets s
where t.code='quotation' and s.code='quotation_details';

-- Редактор сохраняет блоки через body_json. Контекст редактируется как раздел
-- этого же документа и доступен как параметр без повторного ввода.
create function app.sync_quotation_context() returns trigger
language plpgsql set search_path = pg_catalog,app as $$
declare
  v app.indicator_values%rowtype;
  context_id uuid;
  context_blocks jsonb;
begin
  if tg_op = 'DELETE' then v := old; else v := new; end if;
  if not exists (select 1 from app.parameters where id=v.parameter_id and code='text')
     or not exists (select 1 from app.indicators i join app.entities e on e.id=i.entity_id
                    join app.entity_types t on t.id=e.type_id
                    where i.id=v.indicator_id and t.code='quotation') then return null; end if;
  select id into strict context_id from app.parameters where code='quotation_context';
  delete from app.indicator_values where indicator_id=v.indicator_id and parameter_id=context_id;
  if tg_op <> 'DELETE' then
    with blocks as (select value b, n from jsonb_array_elements(v.blocks_value) with ordinality x(value,n)),
    start_at as (select min(n) n from blocks where b->>'type'='heading' and b#>>'{content,0,text}'='Контекст')
    select jsonb_agg(b order by blocks.n) into context_blocks from blocks,start_at
    where blocks.n>start_at.n and blocks.n<coalesce((select min(h.n) from blocks h where h.n>start_at.n and h.b->>'type'='heading'),9223372036854775807);
    if context_blocks is not null then
      insert into app.indicator_values(indicator_id,parameter_id,blocks_value,sort_order)
      values(v.indicator_id,context_id,context_blocks,1);
    end if;
  end if;
  return null;
end $$;
create trigger sync_quotation_context after insert or update of blocks_value or delete on app.indicator_values
for each row execute function app.sync_quotation_context();
