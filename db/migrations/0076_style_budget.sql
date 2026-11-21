alter table app.parameter_set_research_tasks
 drop constraint parameter_set_research_tasks_max_calls_check,
 drop constraint parameter_set_research_tasks_max_source_chars_check,
 add check (max_calls between 1 and 5),
 add check (max_source_chars between 1000 and 200000);
update app.parameter_set_research_tasks t
set model_name='deepseek/deepseek-v4-pro',max_calls=5,max_source_chars=200000
from app.parameter_sets s where t.set_id=s.id and s.code='style_solutions';
