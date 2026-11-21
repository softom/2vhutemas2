import {sql,transaction,type Tx} from './db.ts';
import {ApiError} from './errors.ts';
const fail=(message:string)=>{throw new ApiError('validation_failed',message);};
export async function readSetConfiguration(id:string,tx:Tx=sql){const [r]=await tx<any>`select app.parameter_set_config_snapshot(id) as config from app.parameter_sets where id::text=${id}`;if(!r)throw new ApiError('not_found','Набор не найден');const branches=await tx<any>`select type_id from app.type_parameter_sets where set_id::text=${id}`;
 const types=await tx<any>`select id,title_ru from app.entity_types order by title_ru`;
 const roles=await tx<any>`select id,title_ru from app.link_roles order by title_ru`;
 return {...r.config,branches:branches.map((b:any)=>b.type_id),choices:{types,roles}};}
export async function updateSetConfiguration(id:string|null,input:any,actor:string){
 return transaction(actor,async tx=>{
  if(!id){
   if(!/^[a-z][a-z0-9_]*$/.test(input.code||'')||!input.set?.title_ru?.trim())fail('Укажите код и название набора');
   const [created]=await tx<any>`insert into app.parameter_sets(code,title_ru) values(${input.code},${input.set.title_ru.trim()}) returning id`;
   id=created.id;
  }else{
   const [current]=await tx<any>`select config_version from app.parameter_sets where id::text=${id} for update`;
   if(!current)throw new ApiError('not_found','Набор не найден');
   if(String(input.config_version)!==String(current.config_version))throw new ApiError('version_conflict','Настройки набора изменились. Закройте окно и откройте актуальную версию; ваши изменения пока не сохранены.');
  }
  const [set]=await tx<any>`select * from app.parameter_sets where id::text=${id} for update`;
  if(!set)throw new ApiError('not_found','Набор не найден');

  if(input.set){const x=input.set;
   if(x.title_ru!==undefined&&!x.title_ru.trim())fail('Название не может быть пустым');
   if(x.card_side!==undefined&&!['left','right'].includes(x.card_side))fail('Выберите сторону карточки');
   await tx`update app.parameter_sets set title_ru=coalesce(${x.title_ru?.trim()??null},title_ru),note=case when ${Object.hasOwn(x,'note')} then ${x.note??null} else note end,card_side=coalesce(${x.card_side??null},card_side),research_enabled=coalesce(${x.research_enabled??null},research_enabled),result_kind=coalesce(${x.result_kind??null},result_kind) where id=${set.id}`;}
  for(const uid of input.add_item_ids||[])await tx`insert into app.parameter_set_items(set_id,parameter_id) values(${set.id},${uid}) on conflict do nothing`;
  if(input.remove_item_ids?.length)await tx`delete from app.parameter_set_items where set_id=${set.id} and parameter_id=any(${input.remove_item_ids}::uuid[])`;
  if(input.branches){
   await tx`delete from app.type_parameter_sets where set_id=${set.id}`;
   for(const uid of [...new Set(input.branches)] as string[])await tx`insert into app.type_parameter_sets(set_id,type_id) values(${set.id},${uid})`;
   await tx`update app.parameter_sets set config_version=config_version where id=${set.id}`;
  }
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
   if(!Number.isInteger(x.max_calls??2)||(x.max_calls??2)<1||(x.max_calls??2)>5||!Number.isInteger(x.max_source_chars??60000)||(x.max_source_chars??60000)<1000||(x.max_source_chars??60000)>200000)fail('Бюджет: 1–5 запросов и 1000–200000 символов');
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
