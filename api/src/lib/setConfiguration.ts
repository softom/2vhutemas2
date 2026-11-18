import {sql,transaction,type Tx} from './db.ts';
import {ApiError} from './errors.ts';
const fail=(message:string)=>{throw new ApiError('validation_failed',message);};
export async function readSetConfiguration(id:string,tx:Tx=sql){const [r]=await tx<any>`select app.parameter_set_config_snapshot(id) as config from app.parameter_sets where id::text=${id}`;if(!r)throw new ApiError('not_found','Набор не найден');return r.config;}
export async function updateSetConfiguration(id:string,input:any,actor:string){
 return transaction(actor,async tx=>{
  const [set]=await tx<any>`select * from app.parameter_sets where id::text=${id} for update`;
  if(!set)throw new ApiError('not_found','Набор не найден');
  if(String(input.config_version)!==String(set.config_version))throw new ApiError('version_conflict','Настройки набора изменились');
  if(input.set){const x=input.set;await tx`update app.parameter_sets set research_enabled=coalesce(${x.research_enabled??null},research_enabled),result_kind=coalesce(${x.result_kind??null},result_kind) where id=${set.id}`;}
  for(const patch of input.items||[]){
   const [old]=await tx<any>`select i.*,p.value_type,p.is_repeatable from app.parameter_set_items i join app.parameters p on p.id=i.parameter_id where i.set_id=${set.id} and i.parameter_id::text=${patch.parameter_id}`;
   if(!old)fail('Параметр отсутствует в наборе');
   const x={...old,...patch};
   if(x.repeatability==='multiple'&&!old.is_repeatable)fail('Определение параметра запрещает несколько значений');
   if(x.repeatability!=='inherit'&&x.repeatability!==old.repeatability)fail('Разная повторяемость требует однозначного контекста набора; пока используйте inherit');
   const allowed:Record<string,string[]>={auto:[old.value_type],text:['text'],textarea:['text'],number:['number','integer'],checkbox:['boolean'],select:['option'],date:['date'],entity:['entity'],table:['table']};
   if(!allowed[x.input_kind]?.includes(old.value_type))fail('Вид ввода несовместим с типом параметра');
   const [kind]=await tx<any>`select result_kind from app.parameter_sets where id=${set.id}`;
   if(x.merge_policy==='supplement_relation'&&kind.result_kind!=='relations')fail('Дополнение связи не применяется к значениям');
   if(x.merge_policy==='append_unique'&&!old.is_repeatable&&old.value_type!=='table')fail('Нельзя добавлять несколько одиночных значений');
   await tx`update app.parameter_set_items set label_override=${x.label_override},hint=${x.hint},sort_order=${x.sort_order},input_kind=${x.input_kind},is_required=${x.is_required},repeatability=${x.repeatability},summary_order=${x.summary_order},research_enabled=${x.research_enabled},fill_instruction=${x.fill_instruction},merge_policy=${x.merge_policy},dedup_policy=${x.dedup_policy},source_required=${x.source_required},quote_required=${x.quote_required},minimum_evidence=${x.minimum_evidence},phase_required=${x.phase_required},zone_required=${x.zone_required},result_slot=${x.result_slot} where set_id=${set.id} and parameter_id=${old.parameter_id}`;
  }
  for(const x of input.tasks||[]){
   if(!x.title?.trim()||!x.instruction?.trim())fail('Нужны название и инструкция задания');
   if(x.model_name&&x.model_name!==Deno.env.get('INTAKE_RESEARCH_MODEL')&&x.model_name!=='perplexity/sonar-pro')fail('Модель не разрешена сервером');
   if(x.id){const r=await tx`update app.parameter_set_research_tasks set title=${x.title},instruction=${x.instruction},sort_order=${x.sort_order??0},enabled=${x.enabled??true},model_name=${x.model_name??null},max_calls=${x.max_calls??2},max_source_chars=${x.max_source_chars??60000} where id::text=${x.id} and set_id=${set.id} returning id`;if(!r.length)fail('Задание не принадлежит набору');}
   else await tx`insert into app.parameter_set_research_tasks(set_id,title,instruction,sort_order,enabled,model_name,max_calls,max_source_chars) values(${set.id},${x.title},${x.instruction},${x.sort_order??0},${x.enabled??true},${x.model_name??null},${x.max_calls??2},${x.max_source_chars??60000})`;
  }
  for(const x of input.profiles||[]){
   if(!/^[a-z]{2,3}(-[A-Za-z0-9]+)*$/.test(x.language_tag||'')||!x.query_template?.includes('{title}')||x.query_template.length>1000||/\{(?!title\}|set_title\})/.test(x.query_template))fail('Неверный язык или шаблон запроса');
   if(!Array.isArray(x.topic_terms||[])||(x.topic_terms||[]).some((t:any)=>typeof t!=='string'||t.length>80))fail('Неверные тематические слова');
   if(x.id){const r=await tx`update app.parameter_set_search_profiles set language_tag=${x.language_tag},title_source=${x.title_source},query_template=${x.query_template},sort_order=${x.sort_order??0},enabled=${x.enabled??true},topic_terms=${JSON.stringify(x.topic_terms||[])}::jsonb where id::text=${x.id} and set_id=${set.id} returning id`;if(!r.length)fail('Профиль не принадлежит набору');}
   else await tx`insert into app.parameter_set_search_profiles(set_id,language_tag,title_source,query_template,sort_order,enabled,topic_terms) values(${set.id},${x.language_tag},${x.title_source},${x.query_template},${x.sort_order??0},${x.enabled??true},${JSON.stringify(x.topic_terms||[])}::jsonb)`;
  }
  if(input.types){await tx`delete from app.parameter_set_allowed_types where set_id=${set.id}`;for(const uid of input.types)await tx`insert into app.parameter_set_allowed_types values(${set.id},${uid})`;}
  if(input.roles){await tx`delete from app.parameter_set_allowed_roles where set_id=${set.id}`;for(const uid of input.roles)await tx`insert into app.parameter_set_allowed_roles values(${set.id},${uid})`;}
  return readSetConfiguration(set.id,tx);
 });
}
