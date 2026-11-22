-- Move the parameter itself so values in historical and current revisions keep their UID.
insert into app.parameter_sets(code,title_ru) values ('llm_instructions','ИНСТРУКЦИИ ДЛЯ LLM');
update app.parameters set code='llm_concept_definition',title_ru='Определение понятия для LLM',is_published=false
where code='concept_definition';
update app.parameter_set_items i set set_id=(select id from app.parameter_sets where code='llm_instructions')
from app.parameters p,app.parameter_sets old
where i.parameter_id=p.id and p.code='llm_concept_definition' and old.id=i.set_id and old.code='classification_names';
insert into app.type_parameter_sets(type_id,set_id)
select t.id,s.id from app.entity_types t,app.parameter_sets s
where t.code='architecture_classification' and s.code='llm_instructions';
