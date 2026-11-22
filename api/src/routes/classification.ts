import {singleConstructionYear} from '../lib/attributionPhase.ts';
import {compatibleEvidence} from '../lib/attributionContext.ts';
import {isExcludedResearchRow} from '../lib/researchSourcePolicy.ts';
import {publishOwnerRevision} from '../lib/ownedVersions.ts';
import {Hono} from 'hono';
import {sql,transaction,type Tx} from '../lib/db.ts';
import {require as permit,canSeeDrafts} from '../lib/auth.ts';
import type {AppEnv} from '../lib/http.ts';
import {ApiError} from '../lib/errors.ts';
import {AXES,RELATIONS,classificationCatalog,attributionProposal,normalized} from '../lib/classification.ts';
import {researchData,saveResearch,publicSourceUrl} from '../lib/setResearch.ts';
import {createRecord,setAnswers,saveRevision,createLink} from '../lib/records.ts';
import {validateLinkBody,indexLinkBody,sourceMarks} from '../lib/linkCitations.ts';
import {extractText} from './documents.ts';
import {CLASSIFICATION_SEEDS} from '../lib/classificationSeeds.ts';
export const classification=new Hono<AppEnv>();
const fail=(s:string):never=>{throw new ApiError('validation_failed',s);};
function checked<T>(fn:()=>T):T{try{return fn();}catch(e){throw new ApiError('validation_failed',(e as Error).message);}}
function address(raw:string){const u=new URL(publicSourceUrl(raw));u.hash='';return u.href.replace(/\/$/,'');}
classification.get('/library',async c=>c.json({axes:AXES,relations:RELATIONS,items:await classificationCatalog(sql,canSeeDrafts(c.get('principal')))}));
classification.post('/initialize',async c=>{
 const actor=permit(c.get('principal'),'su');
 const result=await transaction(actor.contributorId,async tx=>{
  await tx`select pg_advisory_xact_lock(20620001)`;
  const items=[];
  for(const s of CLASSIFICATION_SEEDS){
   const [existing]=await tx<any>`select e.id,t.code as axis from app.entities e join app.entity_types t on t.id=e.type_id where ((${s.slug}='modernizm' and e.id=1769) or (${s.slug}<>'modernizm' and e.slug=${s.slug}))`;
   if(existing&&existing.axis!==s.axis)fail('Стартовое понятие найдено в другой оси; нужна ручная проверка');
   if(existing){items.push({id:Number(existing.id),created:false});continue;}
   const record=await createRecord(tx,{type:s.axis,title:s.ru,slugBase:s.slug,contributorId:actor.contributorId});
   await tx`update app.entities set title_en=${s.en} where id=${record.id}`;
   await setAnswers(tx,record.id,[{code:'concept_definition',text:s.definition}]);
   await saveRevision(tx,record.id,actor.contributorId,'Стартовый каталог: определение требует редакторской проверки','create');
   items.push({id:record.id,created:true});
  }
  return items;
 });return c.json({items:result});
});
async function plans(tx:Tx,entityId:number,input:any,context:any={}){
 const [entity]=context.entity?[context.entity]:await tx<any>`select working_revision_id from app.entities where id=${entityId} and status<>'archived' for update`;
 context.entity=entity;
 if(!entity)throw new ApiError('not_found','Сущность не найдена');
 if(entity.working_revision_id!==input.base_revision_id)throw new ApiError('version_conflict','Карточка изменилась; сохраните/перечитайте её');
 const data=context.data||(context.data=await researchData(tx,entityId)),result=data.state.results?.[input.set_id];
 if(!result||result.mode!=='attributions')fail('Нужно новое исследование классификации по ID');
 if(!Array.isArray(input.selections)||!input.selections.length||input.selections.length>200)fail('Выберите от 1 до 200 предложений');
 if(data.state.status==='running')fail('Дождитесь окончания исследования');
 const config=context.config||(context.config=(await tx<any>`select app.parameter_set_config_snapshot(id) as config from app.parameter_sets where id::text=${input.set_id}`)[0]?.config);
 if(!config||config.set.result_kind!=='relations')fail('Набор не предназначен для связей');
 const allowedTypes=await tx<any>`select code from app.entity_types where id=any(${config.types}::uuid[])`;
 const allowedRoles=await tx<any>`select code from app.link_roles where id=any(${config.roles}::uuid[])`;
 const catalog=context.catalog||(context.catalog=(await classificationCatalog(tx,true)).filter(c=>allowedTypes.some((t:any)=>t.code===c.axis))),out:any[]=[];const seen=new Set<string>();
 const baseYear=context.baseYear??(context.baseYear=await singleConstructionYear(tx,entityId,true));
 const phase=(value:unknown)=>normalized(value)===baseYear?'':normalized(value);
 for(const choice of input.selections){
  const raw=result.proposals.find((p:any)=>p.id===choice.id);if(!raw)fail('Предложение отсутствует в сохранённом результате');
  if(!raw.concept_id&&!choice.concept_id)fail('Выберите понятие библиотеки');
  if(raw.concept_id&&choice.concept_id&&Number(choice.concept_id)!==Number(raw.concept_id))fail('Нельзя подменить установленное понятие');
  const p=checked(()=>attributionProposal({...raw,concept_id:raw.concept_id||choice.concept_id||null},catalog,data.sources.filter((s:any)=>!isExcludedResearchRow(s))));
  p.phase=phase(p.phase);
  if(!allowedRoles.some((r:any)=>r.code===p.relation))fail('Отношение не разрешено набором');
  if(config.items.some((i:any)=>i.research_enabled&&i.phase_required)&&!p.phase)fail('Нужна строительная фаза');
  if(config.items.some((i:any)=>i.research_enabled&&i.zone_required)&&!p.zone)fail('Нужна зона объекта');
  if(!p.concept_id)fail('Сначала сопоставьте кандидата с понятием библиотеки');
  if(p.evidence!=='page')fail('Нельзя принять цитату только из поисковой выдержки. Нужен сохранённый текст страницы');
  const source=data.sources.find((s:any)=>s.source_uid===p.source_id);
  const url=checked(()=>address(source.source_url));
  const candidates=context.candidates||(context.candidates=await tx<any>`select distinct e.id,e.title_ru,e.status,e.published_revision_id,e.working_revision_id,v.text_value from app.entities e join app.entity_types t on t.id=e.type_id join app.indicators i on i.entity_id=e.id join app.indicator_values v on v.indicator_id=i.id join app.parameters q on q.id=v.parameter_id where e.status<>'archived' and t.code in('book','article','web_page') and q.code='url'`);
  const matches=candidates.filter((s:any)=>{try{return address(s.text_value)===url;}catch{return false;}});
  if(matches.length>1)fail('Для URL найдено несколько сущностей источника; устраните неоднозначность');
  const sourceEntity=matches[0];
  const links=sourceEntity?await tx<any>`select l.id,l.status,l.published_revision_id,l.working_revision_id,m.id as material_id,r.snapshot->'body_json' as body from app.links l join app.materials m on m.link_id=l.id join app.revisions r on r.id=l.working_revision_id join app.link_roles role on role.id=l.role_id where l.from_entity_id=${entityId} and l.to_entity_id=${p.concept_id} and role.code=${p.relation} and l.status<>'archived' order by l.id`:[];
  const matching=links.filter(l=>sourceMarks(l.body).some(m=>Number(m.props.entityId)===Number(sourceEntity.id)&&compatibleEvidence({phase:phase(m.props.phase),zone:normalized(m.props.zone),quote:normalized(extractText([m.block]))},p)));
  if(matching.length>1)fail('Есть несколько связей этого источника и контекста; требуется ручное сопоставление');
  const current=matching[0];
  const repeated=current&&sourceMarks(current.body).some(m=>normalized(extractText([m.block]))===p.quote)&&current.body.some((b:any)=>b.type==='paragraph'&&normalized(extractText([b]))===p.rationale);
  const identity=JSON.stringify([p.concept_id,url,p.relation]);
  const related=out.filter(x=>x.identity===identity&&compatibleEvidence(x.p,p));
  const keys=[...new Set(related.map(x=>x.key))];
  if(keys.length>1)fail('У свидетельства несколько подходящих контекстов. Уточните фазу или часть объекта.');
  const priorGroup=keys.length?out.filter(x=>x.key===keys[0]):[];
  if(priorGroup.some(x=>!compatibleEvidence(x.p,p)))fail('Фазы или части объекта расходятся. Уточните контекст.');
  const key=keys[0]||JSON.stringify([p.concept_id,url,p.relation,p.phase,p.zone]);const batchAppend=seen.has(key);seen.add(key);
  out.push({identity,batchAppend,key,proposal_id:raw.id,p,source,url,sourceEntity,current,conceptPublished:catalog.find((c:any)=>Number(c.id)===Number(p.concept_id))?.is_published===true,action:repeated?'repeat':current?'append':'create'});
 }
 return {data,out};
}
function planView(x:any){return {proposal_id:x.proposal_id,action:x.batchAppend&&x.action!=='repeat'?'append_batch':x.action,link_id:x.current?.id||null,base_link_revision_id:x.current?.working_revision_id||null,concept_published:x.conceptPublished,source_published:x.sourceEntity?.status==='published'&&sourceMarks(x.current?.body||[]).every(m=>!m.props.sourceRevisionId||m.props.sourceRevisionId===x.sourceEntity.published_revision_id),link_status:x.current?.status||null,published_revision_id:x.current?.published_revision_id||null,source_entity_id:x.sourceEntity?.id||null,source_title:x.source.source_title,url:x.url,before:x.current?extractText(x.current.body):'',after:x.p.rationale,quote:x.p.quote};}
classification.post('/:id/check',async c=>{
 const actor=permit(c.get('principal'),'edit'),id=Number(c.req.param('id')),input=await c.req.json();
 if(!Number.isSafeInteger(id)||id<1)fail('Некорректный ID');
 if(!Array.isArray(input.selections)||!input.selections.length||input.selections.length>200)fail('Выберите от 1 до 200 предложений');
 return c.json(await transaction(actor.contributorId,async tx=>{
  const [entity]=await tx<any>`select working_revision_id from app.entities where id=${id} and status<>'archived' for update`;
  if(!entity)throw new ApiError('not_found','Сущность не найдена');
  const context:any={entity},items=[];const seen=new Map<string,string>();
 for(const choice of input.selections){try{const result=await plans(tx,id,{...input,base_revision_id:entity.working_revision_id,selections:[choice]},context);const x=result.out[0],signature=JSON.stringify([x.key,x.p.quote,x.p.rationale]);const item=planView(x);if(seen.has(signature)&&seen.get(signature)!==x.proposal_id)item.action='duplicate';else seen.set(signature,x.proposal_id);items.push(item);}catch(e){if(!(e instanceof ApiError)||e.status!==400)throw e;items.push({proposal_id:choice.id,action:'blocked',error:e.message});}}
  return {items};
 }));
});
classification.post('/:id/preview',async c=>{
 const actor=permit(c.get('principal'),'edit'),id=Number(c.req.param('id')),input=await c.req.json();
 if(!Number.isSafeInteger(id)||id<1)fail('Некорректный ID');
 const result=await transaction(actor.contributorId,tx=>plans(tx,id,input));
 return c.json({items:result.out.map(planView)});
});
classification.post('/:id/accept',async c=>{
 const actor=permit(c.get('principal'),'create_delete'),id=Number(c.req.param('id')),input=await c.req.json();permit(actor,'edit');
 if(!Number.isSafeInteger(id)||id<1)fail('Некорректный ID');
 return c.json(await transaction(actor.contributorId,async tx=>{
  // Serialize URL resolution and attribution creation, including across objects.
  await tx`select pg_advisory_xact_lock(20620002)`;
  let createdConcept:number|null=null;
  if(input.new_concept){
   permit(actor,'publish');
   const title=normalized(input.new_concept.title),axis=input.new_concept.axis;
   if(!title||title.length>200||!Object.hasOwn(AXES,axis)||input.selections?.length!==1)fail('Проверьте название и ось одного нового понятия');
   const choice=input.selections[0],previous=await researchData(tx,id);
   const raw=previous.state.results?.[input.set_id]?.proposals?.find((p:any)=>p.id===choice.id);
   if(!raw||raw.concept_id||!raw.candidate_name)fail('Создать понятие можно только для несопоставленного кандидата');
   const keys=[title,raw.candidate_name].map(s=>normalized(s).toLowerCase().replace(/ё/g,'е'));
   const catalog=await classificationCatalog(tx,true);
   if(catalog.some(c=>[c.title_ru,c.title_en,c.title_original,...c.names.map((n:any)=>n.concept_name_text)].some(n=>keys.includes(normalized(n).toLowerCase().replace(/ё/g,'е')))))fail('Название уже есть в библиотеке. Обновите предложения и выберите существующее понятие.');
   const record=await createRecord(tx,{type:axis,title,contributorId:actor.contributorId});
   createdConcept=record.id;
   const rev=await saveRevision(tx,record.id,actor.contributorId,'Создано понятие из проверенного предложения','create');
   await publishOwnerRevision(tx,{kind:'entity',id:record.id},rev,actor.contributorId,'Публикация понятия из предложения');
   choice.concept_id=record.id;
  }
  const {data,out}=await plans(tx,id,input);
  if(createdConcept){
   const saved=data.state.results[input.set_id].proposals.find((p:any)=>p.id===out[0].proposal_id);
   Object.assign(saved,{concept_id:createdConcept,axis:out[0].p.axis,title:out[0].p.title,candidate_name:''});
  }
const applied=[];const sourceCache=new Map<string,any>();const linkCache=new Map<string,any>();
  for(const x of out){
   const expected=input.expected?.find((e:any)=>e.proposal_id===x.proposal_id);
   if(!createdConcept&&(!expected||String(expected.link_id||'')!==String(x.current?.id||'')||expected.base_link_revision_id!==(x.current?.working_revision_id||null)||String(expected.source_entity_id||'')!==String(x.sourceEntity?.id||'')))throw new ApiError('version_conflict','Эта связь изменилась другим редактором. Её статус обновлён.',{proposal_id:x.proposal_id});
   const prior=linkCache.get(x.key);if(prior){x.current=prior;x.action=sourceMarks(prior.body).some(m=>normalized(extractText([m.block]))===x.p.quote)&&prior.body.some((b:any)=>b.type==='paragraph'&&normalized(extractText([b]))===x.p.rationale)?'repeat':'append';}
   if(x.current)await tx`select id from app.links where id=${x.current.id} for update`;
   // Recheck under the lock: ordinary PATCH uses the same row lock.
   if(x.current){const [v]=await tx<any>`select working_revision_id from app.links where id=${x.current.id}`;if(v.working_revision_id!==x.current.working_revision_id)throw new ApiError('version_conflict','Обоснование изменилось другим редактором',{proposal_id:x.proposal_id});}
   let source=x.sourceEntity||sourceCache.get(x.url);
   if(!source){const created=await createRecord(tx,{type:'web_page',title:x.source.source_title||x.url,contributorId:actor.contributorId});await setAnswers(tx,created.id,[{code:'url',text:x.url}]);const revision=await saveRevision(tx,created.id,actor.contributorId,'Источник принятой цитаты','create');source={id:created.id,working_revision_id:revision};sourceCache.set(x.url,source);}
   if(x.action==='repeat'){applied.push({proposal_id:x.proposal_id,link_id:Number(x.current.id),action:'repeat'});continue;}
   const addition=[{id:crypto.randomUUID(),type:'paragraph',content:[{type:'text',text:x.p.rationale,styles:{}}]},{id:crypto.randomUUID(),type:'quote',content:[{type:'text',text:x.p.quote,styles:{}},{type:'sourceRef',props:{entityId:String(source.id),sourceRevisionId:String(source.working_revision_id),occurrenceId:crypto.randomUUID(),note:x.p.locator,accessedAt:(x.source.source_fetched||'').slice(0,10),phase:x.p.phase,zone:x.p.zone,evidenceRevisionId:input.base_revision_id}}]}];
   const blocks=await validateLinkBody(tx,[...(x.current?.body||[]),...addition],true);
   let linkId=x.current?.id;
   if(!linkId)linkId=await createLink(tx,{from:id,to:x.p.concept_id,role:x.p.relation,justification:x.p.rationale,contributorId:actor.contributorId});
   const [revision]=await tx<any>`insert into app.revisions(material_id,base_revision_id,edited_by,operation,summary,snapshot) select m.id,l.working_revision_id,${actor.contributorId},'edit','Принята атрибуция из исследования',${JSON.stringify({body_json:blocks})}::jsonb from app.links l join app.materials m on m.link_id=l.id where l.id=${linkId} returning id`;
   await indexLinkBody(tx,revision.id,blocks);
   linkCache.set(x.key,{id:linkId,working_revision_id:revision.id,body:blocks});
   applied.push({proposal_id:x.proposal_id,link_id:Number(linkId),revision_id:revision.id,action:x.action});
  }
  data.state.accepted_attributions=[...(data.state.accepted_attributions||[]),...applied.map(x=>({...x,at:new Date().toISOString(),actor_id:actor.contributorId}))];
  const revision=await saveResearch(tx,id,actor.contributorId,data);
  return {items:applied,revision};
 }));
});
