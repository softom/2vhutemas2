import {Hono} from 'hono';
import type {AppEnv} from '../lib/http.ts';
import {log} from '../lib/http.ts';
import {sql,transaction} from '../lib/db.ts';
import {require as permit} from '../lib/auth.ts';
import {ApiError} from '../lib/errors.ts';
import {callerOf} from '../lib/aiJournal.ts';
import {researchData,saveResearch,researchSet,gather,analyzeSet,type ResearchProgress} from '../lib/setResearch.ts';
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
 if(data.state.status==='running'&&active.has(id)){data.state.progress=active.get(id);data.state.log=journals.get(id)||[];}
 if(data.state.status==='running'&&!active.has(id))data.state={...data.state,status:'error',error:'Задание прервано перезапуском сервиса. Повторите запуск.'};
 return c.json({...data,revision:chain.safe?e.working_revision_id:null});
});
setResearch.post('/:id/:action',async c=>{
 const actor=permit(c.get('principal'),'edit'),caller=await callerOf(c),id=entityId(c.req.param('id')),action=c.req.param('action');
 if(!['collect','analyze'].includes(action))throw new ApiError('not_found','Действие не найдено');
 const input=await c.req.json(),set=await researchSet(String(input.set_id));
 if(active.has(id)||active.size>=2)throw new ApiError('rate_limited','Уже выполняется исследование. Дождитесь завершения');
 active.set(id,{phase:action==='collect'?'Поиск источников':'Подготовка анализа',done:0,total:null});journals.set(id,[]);addLog(id,caller.requestId,action==='collect'?'Начат сбор источников':'Начат анализ источников');let prepared:any;
 try{prepared=await transaction(actor.contributorId,async tx=>{
  const [entity]=await tx<any>`select id,title_ru,working_revision_id from app.entities where id=${id} and status<>'archived' for update`;
  if(!entity)throw new ApiError('not_found','Запись не найдена');
  if(entity.working_revision_id!==input.base_revision_id)throw new ApiError('version_conflict','Сохранённая версия изменилась. Обновите редактор');
  const attached=await tx`select set_id from app.entity_parameter_sets where entity_id=${id} and set_id=${set.id} union select t.set_id from app.type_parameter_sets t join app.entities e on e.id=${id} where t.set_id=${set.id} and t.type_id in(select app.entity_type_ancestors(e.type_id))`;
  if(!attached.length)throw new ApiError('validation_failed','Сначала добавьте набор');
  const data=await researchData(tx,id),job=crypto.randomUUID();
  const state={...data.state,job,action,set_id:set.id,status:'running',progress:active.get(id),log:journals.get(id),request_id:caller.requestId,warnings:[],started_at:new Date().toISOString(),error:null};
  const revision=await saveResearch(tx,id,actor.contributorId,{sources:data.sources,state});
  return {title:entity.title_ru,sources:data.sources,state,revision};
 });}catch(e){active.delete(id);journals.delete(id);throw e;}
 void(async()=>{
  let result:any;const progress=(value:ResearchProgress)=>{
   active.set(id,value);
   addLog(id,caller.requestId,value.phase+(value.total!=null?`: ${value.done} из ${value.total}`:'')+(value.accepted!=null?`; принято ${value.accepted}, отклонено ${value.rejected||0}`:''));
  };
  try{result=action==='collect'?await gather(prepared.title,set,prepared.sources,caller,progress):await analyzeSet(prepared.title,set,prepared.sources,caller,progress);}
  catch(e){result={error:String(e).slice(0,500)};log('error',caller.requestId,'Исследование набора не завершено',{entity_id:id,error:String(e)});}
  for(const warning of result.warnings||[])addLog(id,caller.requestId,warning,'warning');
  addLog(id,caller.requestId,result.error?'Задание завершилось ошибкой: '+result.error:action==='analyze'?`Анализ завершён: получено ${result.received||0}, принято ${result.proposals?.length||0}, отклонено ${result.rejected||0}, ошибок частей ${result.failed_parts||0}`:`Сбор завершён: источников ${result.sources?.length||0}, полных текстов ${result.sources?.filter((s:any)=>s.source_text).length||0}`,result.error?'error':'info');
  await transaction(actor.contributorId,async tx=>{
   await tx`select id from app.entities where id=${id} for update`;
   const current=await researchData(tx,id);if(current.state.job!==prepared.state.job)return;
   const state={...current.state,status:result.error?'error':'ready',progress:active.get(id),log:journals.get(id),finished_at:new Date().toISOString(),error:result.error||null,warnings:result.warnings||[]};
   if(action==='analyze'&&!result.error)state.results={...state.results,[set.id]:{...result,created_at:state.finished_at}};
   await saveResearch(tx,id,actor.contributorId,{sources:action==='collect'&&result.sources?result.sources:current.sources,state});
  });
 })().catch(e=>log('error',caller.requestId,'Ошибка сохранения исследования',{entity_id:id,error:String(e)})).finally(()=>{active.delete(id);journals.delete(id);});
 return c.json({sources:prepared.sources,state:prepared.state,revision:prepared.revision},202);
});
