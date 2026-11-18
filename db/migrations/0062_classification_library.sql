-- Four independent axes. Existing entity/type UIDs and snapshots are retained.
insert into app.entity_types(code,title_ru,parent_id,sort_order)
select 'architecture_classification','Архитектурная классификация',parent_id,5 from app.entity_types where code='art_epochs';
update app.entity_types set parent_id=(select id from app.entity_types where code='architecture_classification'),title_ru=case code when 'art_epochs' then 'Эпоха / парадигма' else 'Направление / школа' end where code in('art_epochs','art_styles');
insert into app.entity_types(code,title_ru,parent_id,sort_order)
select code,title,(select id from app.entity_types where code='architecture_classification'),ord from (values
 ('form_method','Метод формообразования',15),('morphological_trait','Морфологический признак',25)) x(code,title,ord);
insert into app.parameter_sets(code,title_ru,note) values
 ('classification_names','Понятие классификации','Определение и многоязычные имена одного понятия'),
 ('classification_name_row','Имя понятия','Язык, имя и назначение');
insert into app.parameters(code,title_ru,value_type,sort_order) values
 ('concept_definition','Определение понятия','text',0),
 ('concept_name_language','Язык (BCP 47)','text',0),('concept_name_text','Имя','text',1),('concept_name_kind','Назначение: перевод / синоним / оригинал','text',2);
insert into app.parameter_set_items(set_id,parameter_id,sort_order)
select s.id,p.id,p.sort_order from app.parameter_sets s,app.parameters p where s.code='classification_name_row' and p.code in('concept_name_language','concept_name_text','concept_name_kind');
insert into app.parameters(code,title_ru,value_type,row_set_id,sort_order)
select 'concept_names','Переводы и синонимы','table',id,1 from app.parameter_sets where code='classification_name_row';
insert into app.parameter_set_items(set_id,parameter_id,sort_order)
select s.id,p.id,p.sort_order from app.parameter_sets s,app.parameters p where s.code='classification_names' and p.code in('concept_definition','concept_names');
insert into app.type_parameter_sets(type_id,set_id)
select t.id,s.id from app.entity_types t,app.parameter_sets s where t.code='architecture_classification' and s.code='classification_names';
insert into app.link_roles(code,title_ru) values
 ('classification_membership','Принадлежность к понятию'),('classification_citation','Цитирование приёма'),
 ('classification_trait','Наличие признака'),('classification_negation','Отрицание атрибуции') on conflict(code) do nothing;
