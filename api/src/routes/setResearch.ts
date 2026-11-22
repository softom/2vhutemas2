import {AXES,resolveConcept} from '../lib/classificationValidation.ts';
import {saveRevision} from '../lib/records.ts';
import {preflight,presets,type Depth} from '../lib/researchBudget.ts';
import {Hono} from 'hono';
import type {AppEnv} from '../lib/http.ts';
import {log} from '../lib/http.ts';
import {sql,transaction} from '../lib/db.ts';
import {require as permit} from '../lib/auth.ts';
import {ApiError} from '../lib/errors.ts';
import {callerOf} from '../lib/aiJournal.ts';
import {researchData,saveResearch,researchSet,gather,analyzeSet,missingParts,type ResearchProgress} from '../lib/setResearch.ts';
export const setResearch=new Hono<AppEnv>();
const active=new Map<number,ResearchProgress>();
type JobLog={at:string;level:'info'|'warning'|'error';message:string};
const journals=new Map<number,JobLog[]>();
function addLog(id:number,requestId:string,message:string,level:JobLog['level']='info'){
 const entries=journals.get(id)||[];
 entries.push({at:new Date().toISOString(),level,message});
 if(entries.length>500){entries.splice(0,entries.length-499);entries.unshift({at:entries[0].at,level:'warning',message:'Показаны последние 499 событий. Полный журнал — в логах API.'});}
 journals.set(id,entries);
 log(level==='warning'?'warn':level,requestId,message,{entity_id:id,scope:'set-research'});
}
setResearch.use('*',async(c,next)=>{permit(c.get('principal'),'edit');await next();});
function entityId(value:string){const n=Number(value);if(!Number.isSafeInteger(n)||n<1)throw new ApiError('validation_failed','Неверный ID');return n;}
setResearch.get('/:id',async c=>{
 const id=entityId(c.req.param('id'));
 const [e]=await sql<any>`select working_revision_id from app.entities where id=${id} and status<>'archived'`;
 if(!e)throw new ApiError('not_found','Запись не найдена');
 const base=c.req.query('base');
 const [chain]=base?await sql<any>`with recursive chain as (
 select id,base_revision_id,summary from app.revisions where id=${e.working_revision_id}
 union all select r.id,r.base_revision_id,r.summary from app.revisions r join chain c on r.id=c.base_revision_id where c.id::text<>${base} and c.summary='Обновлены материалы исследования')
 select exists(select 1 from chain where id::text=${base}) as safe`: [{safe:false}];
 const data=await researchData(sql,id);
 const pending=Object.values(data.state.results||{}).flatMap((r:any)=>r.mode==='attributions'?(r.proposals||[]).filter((p:any)=>!p.concept_id):[]);
 if(pending.length){
  const catalog=await sql<any>`select e.id,e.title_ru,e.title_en,e.title_original,t.code axis,
    coalesce((select app.table_rows_json(p.id,v.table_value) from app.indicators i join app.indicator_values v on v.indicator_id=i.id join app.parameters p on p.id=v.parameter_id where i.entity_id=e.id and p.code='concept_names' order by i.sort_order,i.id limit 1),'[]'::jsonb) names
    from app.entities e join app.entity_types t on t.id=e.type_id where e.status<>'archived' and t.code=any(${Object.keys(AXES)}::text[])`;
  for(const p of pending){
   const concept=resolveConcept(p,catalog);
   p.suggested_concept_id=concept?Number(concept.id):null;
  }
 }
 if(data.state.status==='running'&&active.has(id)){data.state.progress=active.get(id);data.state.log=journals.get(id)||[];}
 if(data.state.status==='running'&&!active.has(id))data.state={...data.state,status:'error',error:'Задание прервано перезапуском сервиса. Повторите запуск.'};
 return c.json({...data,revision:chain.safe?e.working_revision_id:null});
});
function identityKey(e:any){return JSON.stringify([e.title_ru,e.title_en,e.title_original,e.original_language]);}
function aliases(value:unknown):string[]{
 if(!Array.isArray(value)||value.length>12||value.some(s=>typeof s!=='string'||s.trim().length<3||s.length>180))throw new ApiError('validation_failed','Укажите до 12 полных названий по 3–180 символов');
 return [...new Set(value.map(s=>s.trim()))];
}
setResearch.get('/:id/plan',async c=>{
 const id=entityId(c.req.param('id')),data=await researchData(sql,id),set=await researchSet(String(c.req.query('set_id')),c.req.query('task_id')||undefined);
 const [e]=await sql<any>`select title_ru,title_en,title_original,original_language from app.entities where id=${id}`;
 const key=identityKey(e),saved=data.state.name_review;
 const variants=set.code==='style_solutions'?(c.req.query('custom_aliases')==='1'?aliases(c.req.queries('alias')||[]):saved?.key===key?saved.aliases:[]):[];
 const summary=preflight(data.sources,set,[e.title_ru,e.title_en,e.title_original,...variants]);
 return c.json({...summary,identity:set.code==='style_solutions'?{...e,key,aliases:variants}:undefined});
});
setResearch.post('/:id/clear',async c=>{
 const actor=permit(c.get('principal'),'edit'),id=entityId(c.req.param('id')),input=await c.req.json();
 const result=await transaction(actor.contributorId,async tx=>{
  const [entity]=await tx<any>`select working_revision_id from app.entities where id=${id} and status<>'archived' for update`;
  if(!entity)throw new ApiError('not_found','Запись не найдена');
  if(active.has(id)||entity.working_revision_id!==input.base_revision_id)throw new ApiError('version_conflict','Карточка изменилась или исследование выполняется. Обновите страницу.');
  const [row]=await tx<any>`select v.id,v.text_value from app.indicator_values v join app.indicators i on i.id=v.indicator_id join app.parameters p on p.id=v.parameter_id where i.entity_id=${id} and p.code='research_state' for update of v`;
  const state=JSON.parse(row?.text_value||'{}');
  let revision=entity.working_revision_id;
  if(state.results&&Object.hasOwn(state.results,input.set_id)){
   delete state.results[input.set_id];
   if(state.set_id===input.set_id){Object.assign(state,{action:'clear',status:'ready',error:null,warnings:[],progress:null,finished_at:new Date().toISOString()});}
   await tx`update app.indicator_values set text_value=${JSON.stringify(state)} where id=${row.id}`;
   revision=await saveRevision(tx,id,actor.contributorId,'Очищены предложения LLM набора '+input.set_id);
  }
  return {...await researchData(tx,id),revision};
 });
 return c.json(result);
});
setResearch.post('/:id/:action',async c=>{
 const actor=permit(c.get('principal'),'edit'),caller=await callerOf(c),id=entityId(c.req.param('id')),action=c.req.param('action');
 if(!['collect','analyze','resume'].includes(action))throw new ApiError('not_found','Действие не найдено');
 const input=await c.req.json(),set=await researchSet(String(input.set_id),input.task_id);
 const depth:Depth=input.mode??'medium';
 if(!Object.hasOwn(presets,depth))throw new ApiError('validation_failed','Неизвестный режим исследования');
 if(active.has(id)||active.size>=2)throw new ApiError('rate_limited','Уже выполняется исследование. Дождитесь завершения');
 active.set(id,{phase:action==='collect'?'Поиск источников':'Подготовка анализа',done:0,total:null});journals.set(id,[]);addLog(id,caller.requestId,action==='collect'?'Начат сбор источников':'Начат анализ источников');let prepared:any;
 try{prepared=await transaction(actor.contributorId,async tx=>{
  const [entity]=await tx<any>`select id,title_ru,title_en,title_original,original_language,working_revision_id from app.entities where id=${id} and status<>'archived' for update`;
  if(!entity)throw new ApiError('not_found','Запись не найдена');
  if(entity.working_revision_id!==input.base_revision_id)throw new ApiError('version_conflict','Сохранённая версия изменилась. Обновите редактор');
  const attached=await tx`select set_id from app.entity_parameter_sets where entity_id=${id} and set_id=${set.id} union select t.set_id from app.type_parameter_sets t join app.entities e on e.id=${id} where t.set_id=${set.id} and t.type_id in(select app.entity_type_ancestors(e.type_id))`;
  if(!attached.length)throw new ApiError('validation_failed','Сначала добавьте набор');
  const data=await researchData(tx,id),job=crypto.randomUUID();
  const review=data.state.name_review;
  if(set.code==='style_solutions'&&action!=='resume'&&!entity.title_en?.trim()&&!entity.title_original?.trim()&&!/[А-Яа-яЁё]/.test(entity.title_ru)&&!(review?.key===identityKey(entity)&&review.aliases?.length)){
   throw new ApiError('validation_failed','Не удалось определить название для поиска. Укажите английское или оригинальное название в карточке объекта и повторите запуск.');
  }
  const prior=action==='resume'?data.state.results?.[set.id]:undefined;
  if(action==='resume'&&(!prior||!missingParts(prior).length||prior.task_id!==set.task.id))throw new ApiError('validation_failed','Нет пропущенных частей для этого задания');
  if(prior&&!prior.pending_parts&&data.state.finished_at!==prior.created_at)throw new ApiError('validation_failed','Корпус старого прогона нельзя подтвердить');
  const state={...data.state,name_review:review,job,action,depth:prior?.budget?.depth||depth,set_id:set.id,task_id:set.task.id,config_version:set.config_version,status:'running',progress:active.get(id),log:journals.get(id),request_id:caller.requestId,warnings:[],started_at:new Date().toISOString(),error:null};
  const revision=await saveResearch(tx,id,actor.contributorId,{sources:data.sources,state});
  const [context]=action==='collect'&&set.code==='style_solutions'?await tx<any>`select
   (select x.title_ru from app.links l join app.link_roles r on r.id=l.role_id join app.entities x on x.id=case when l.from_entity_id=${id} then l.to_entity_id else l.from_entity_id end where ${id} in(l.from_entity_id,l.to_entity_id) and l.status<>'archived' and x.status<>'archived' and r.code in ('architect','author') order by (r.code='architect') desc,l.is_primary desc,l.id limit 1) architect,
   (select city.text_value from app.indicators i join app.indicator_values v on v.indicator_id=i.id join app.indicators place on place.entity_id=v.entity_value_id join app.indicator_values city on city.indicator_id=place.id join app.parameters p on p.id=city.parameter_id where i.entity_id=${id} and i.is_current and place.is_current and p.code='settlement' order by i.sort_order,v.sort_order,city.id limit 1) city`: [];
  return {prior,title:entity.title_ru,identity:{...context,aliases:set.code==='style_solutions'&&review?.key===identityKey(entity)?review.aliases:[],title_ru:entity.title_ru,title_en:entity.title_en,title_original:entity.title_original,original_language:entity.original_language},sources:data.sources,state,revision};
 });}catch(e){active.delete(id);journals.delete(id);throw e;}
 void(async()=>{
  let result:any;const progress=(value:ResearchProgress)=>{
   active.set(id,value);
   addLog(id,caller.requestId,value.phase+(value.total!=null?`: ${value.done} из ${value.total}`:'')+(value.accepted!=null?`; принято ${value.accepted}, отклонено ${value.rejected||0}`:''));
  };
  const checkpoint=async(partial:any)=>{
   await transaction(actor.contributorId,async tx=>{
    const changed=await tx`update app.indicator_values v set text_value=jsonb_set(v.text_value::jsonb,'{results}',coalesce(v.text_value::jsonb->'results','{}'::jsonb)||jsonb_build_object(${String(set.id)}::text,${JSON.stringify(partial)}::jsonb))::text
     from app.indicators i,app.parameters p where i.id=v.indicator_id and i.entity_id=${id} and p.id=v.parameter_id and p.code='research_state' and v.text_value::jsonb->>'job'=${prepared.state.job} returning v.id`;
    if(!changed.length)throw Error('Исследование уже заменено');
   });
  };
  try{result=action==='collect'?await gather(prepared.identity,set,prepared.sources,caller,progress,depth):await analyzeSet(prepared.title,set,prepared.sources,caller,progress,[prepared.identity.title_ru,prepared.identity.title_en,prepared.identity.title_original,...prepared.identity.aliases],prepared.state.depth,prepared.prior,checkpoint);}
  catch(e){result={error:String(e).slice(0,500)};log('error',caller.requestId,'Исследование набора не завершено',{entity_id:id,error:String(e)});}
  for(const warning of result.warnings||[])addLog(id,caller.requestId,warning,'warning');
  addLog(id,caller.requestId,result.error?'Задание завершилось ошибкой: '+result.error:action!=='collect'?`Анализ завершён: получено ${result.received||0}, принято ${result.proposals?.length||0}, отклонено ${result.rejected||0}, ошибок частей ${result.failed_parts||0}`:`Сбор завершён: источников ${result.sources?.length||0}, полученных текстов ${result.sources?.filter((s:any)=>s.source_text).length||0}`,result.error?'error':'info');
  await transaction(actor.contributorId,async tx=>{
   await tx`select id from app.entities where id=${id} for update`;
   const current=await researchData(tx,id);if(current.state.job!==prepared.state.job)return;
   const state={...current.state,status:result.error?'error':'ready',progress:active.get(id),log:journals.get(id),finished_at:new Date().toISOString(),error:result.error||null,warnings:result.warnings||[]};
   if(action!=='collect'&&!result.error)state.results={...state.results,[set.id]:{...result,created_at:state.finished_at}};
   await saveResearch(tx,id,actor.contributorId,{sources:action==='collect'&&result.sources?result.sources:current.sources,state});
  });
 })().catch(e=>log('error',caller.requestId,'Ошибка сохранения исследования',{entity_id:id,error:String(e)})).finally(()=>{active.delete(id);journals.delete(id);});
 return c.json({sources:prepared.sources,state:prepared.state,revision:prepared.revision},202);
});
