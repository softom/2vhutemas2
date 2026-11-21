-- Общая модель хранит главный текст в body_json. Для типа «Цитата»
-- обязательные блоковые параметры также входят в версионные values.
do $migration$
declare
 definition text := pg_get_functiondef('app.entity_snapshot(bigint,jsonb)'::regprocedure);
 old_filter text := 'where i.entity_id = e.id and p.value_type <> ''blocks''';
 new_filter text := $filter$where i.entity_id = e.id and (p.value_type <> 'blocks'
   or (p.code in ('text','quotation_context')
       and jsonb_array_length(v.blocks_value)>0
       and e.type_id=(select id from app.entity_types where code='quotation')))$filter$;
begin
 if strpos(definition,old_filter)=0 then raise exception 'Unexpected entity_snapshot definition'; end if;
 execute replace(definition,old_filter,new_filter);
end $migration$;
