import './json.ts';
import {Hono} from 'hono';
import {sql,transaction,closePool} from './db.ts';
import {researchData,saveResearch,researchSet,gather,analyzeSet,validateProposal,publicSourceUrl} from './setResearch.ts';
import {createRecord,saveRevision,setAnswers} from './records.ts';
import {writeIndicators,readAll} from '../routes/indicators.ts';
import {entities} from '../routes/entities.ts';
import {setResearch} from '../routes/setResearch.ts';
import {storeExternalDescriptions} from './entityExternalDescriptions.ts';
import type {AppEnv} from './http.ts';
import {handleError} from './http.ts';
const ok=(v:unknown,message:string)=>{if(!v)throw new Error(message);};
const rejects=(fn:()=>unknown)=>{let failed=false;try{fn();}catch{failed=true;}ok(failed,'must reject');};
Deno.test({name:'research sets: corpus, thematic Yandex, LLM validation, privacy, preservation and revision conflicts',sanitizeOps:false,sanitizeResources:false,fn:async()=>{
 ok(Deno.env.get('APP_API_DB_NAME')==='codex_set_research_0058','isolated DB only');
 const original=globalThis.fetch;const caller={contributorId:null,visitorKey:null,requestId:crypto.randomUUID()};
 try{
  const [actor]=await sql<any>`select id,auth_uid from app.contributors where status='active' limit 1`;
  const record=await transaction(actor.id,tx=>createRecord(tx,{type:'document',title:'Research regression '+crypto.randomUUID(),contributorId:actor.id}));
  const id=record.id;let revision='';
  const [setrow]=await sql<any>`select id from app.parameter_sets where code='style_solutions'`;
  const set=await researchSet(setrow.id);
  const source={source_uid:crypto.randomUUID(),source_url:'https://example.org/building',source_title:'Fixture',source_text:'PRIVATE_CORPUS_MARKER '+'x'.repeat(50000),source_excerpt:'PRIVATE_SNIPPET',source_provider:'fixture',source_sets:'[]',source_queries:'[]',source_status:'Текст получен'};
  await transaction(actor.id,async tx=>{
   await tx`insert into app.entity_parameter_sets(entity_id,set_id) values(${id},${set.id})`;
   await writeIndicators(tx,id,[{title:'Manual group',values:[{parameter:'summary',text_value:'MANUAL_VALUE'}]}]);
   revision=await saveResearch(tx,id,actor.id,{sources:[source],state:{results:{private:'PRIVATE_RESULT'}}});
   await tx`update app.entities set status='published',published_revision_id=working_revision_id where id=${id}`;
  });
  ok((await researchData(sql,id)).sources[0].source_text===source.source_text,'corpus round trip');
  const principal={authUid:actor.auth_uid,contributorId:actor.id,displayName:'test',status:'active' as const,permissions:new Set<any>(['edit','create_delete','publish'])};
  const app=new Hono<AppEnv>();app.use('*',async(c,next)=>{c.set('principal',c.req.header('x-test-role')==='edit'?principal:c.req.header('x-test-role')==='review'?{...principal,permissions:new Set<any>(['review'])}:null);c.set('requestId',crypto.randomUUID());await next();});app.route('/entities',entities);app.route('/research',setResearch);
  for(const role of ['', 'review']){
   const res=await app.request('/entities/'+id,{headers:{'x-test-role':role}});const body=await res.text();ok(res.ok,'read '+role);ok(!body.includes('PRIVATE_'),'public/reviewer leak');ok(body.includes('MANUAL_VALUE'),'manual public value');
   ok(!(await app.request('/research/'+id,{headers:{'x-test-role':role}})).ok,'research permission');
  }
  const edit=await (await app.request('/entities/'+id,{headers:{'x-test-role':'edit'}})).json();ok(edit.indicators.some((g:any)=>g.values.some((v:any)=>v.text_value==='MANUAL_VALUE')),'editor values');
  app.onError(handleError);
  const [search]=await sql<any>`select app.search_revision_source(${revision})::text as text`;ok(!search.text.includes('PRIVATE_'),'search leak');
  await transaction(actor.id,async tx=>{await writeIndicators(tx,id,edit.indicators);await saveRevision(tx,id,actor.id,'Manual edit');});
  ok((await researchData(sql,id)).sources.length===1,'normal save preserves technical values');
  const conflict=await app.request('/research/'+id+'/analyze',{method:'POST',headers:{'content-type':'application/json','x-test-role':'edit'},body:JSON.stringify({set_id:set.id,base_revision_id:revision})});ok(!conflict.ok,'stale revision rejected');
  const safe=await (await app.request('/research/'+id+'?base='+revision,{headers:{'x-test-role':'edit'}})).json();ok(safe.revision===null,'never advance across manual revision');
  for(const u of ['http://127.0.0.1','http://169.254.169.254','http://[::1]','http://foo.internal','https://user:pass@example.org','file:///etc/passwd'])rejects(()=>publicSourceUrl(u));
  let query='',calls=0;
  globalThis.fetch=async(input:any,init?:RequestInit)=>{
   const url=String(input);
   if(url.includes('yandex.net')){query=JSON.parse(String(init?.body)).query.queryText;return Response.json({rawData:btoa('<doc><url>https://example.org/area</url><title>Area</title><passages><passage>Area 500</passage></passages></doc>')});}
   if(url.startsWith('https://r.jina.ai/'))return new Response('Area 500 square metres');
   if(url.includes('wikipedia.org'))return Response.json({query:{search:[]}});
   if(url.includes('openalex.org'))return Response.json({results:[]});
   if(url.endsWith('/chat/completions')){calls++;const body=JSON.parse(String(init?.body));const ctx=JSON.parse(body.messages[1].content);return Response.json({choices:[{message:{content:JSON.stringify({proposals:[{parameter_id:set.parameters[0].id,value:[{style_name:'Gothic',style_reason:'fixture'}],source_ids:[ctx.sources[0].id],rationale:'fixture'}]})}}]});}
   return new Response('');
  };
  const collected=await gather('Building',{code:'tep',title_ru:'ТЭП',id:set.id,parameters:[]},[source],caller);ok(query.includes('площадь')&&!query.includes('стиль'),'Yandex thematic query');ok(collected.sources.length===2&&collected.sources[0].source_text===source.source_text,'collection preserves corpus');
  const analyzed=await analyzeSet('Building',set,[source],caller);ok(calls>=2&&analyzed.proposals.length===calls,'all corpus chunks processed');ok(analyzed.proposals.every((p:any)=>p.selected===false),'nothing preselected');
  const [current]=await sql<any>`select working_revision_id from app.entities where id=${id}`;
  const job=await app.request('/research/'+id+'/analyze',{method:'POST',headers:{'content-type':'application/json','x-test-role':'edit'},body:JSON.stringify({set_id:set.id,base_revision_id:current.working_revision_id})});ok(job.status===202,'job accepted');const started=await job.json();
  let completed:any;
  for(let attempt=0;attempt<100;attempt++){completed=await (await app.request('/research/'+id+'?base='+started.revision,{headers:{'x-test-role':'edit'}})).json();if(completed.state.status!=='running')break;await new Promise(r=>setTimeout(r,50));}
  ok(completed.state.status==='ready'&&completed.revision&&completed.state.results[set.id].proposals.length>=2,'async job persisted and safe revision advanced');
  rejects(()=>validateProposal({parameter_id:set.parameters[0].id,value:[{unknown:'x'}],source_ids:[source.source_uid]},set.parameters,new Set([source.source_uid])));
  rejects(()=>validateProposal({parameter_id:set.parameters[0].id,value:[],source_ids:['invented']},set.parameters,new Set([source.source_uid])));
  // Published snapshots and nested table cells respect later visibility changes.
  await transaction(actor.id,async tx=>{await writeIndicators(tx,id,[{title:'Styles',values:[{parameter:'style_solutions',rows:[{style_name:'PUBLIC_STYLE',style_reason:'PRIVATE_CELL'}]}]}]);revision=await saveRevision(tx,id,actor.id,'Styles');await tx`update app.entities set published_revision_id=working_revision_id where id=${id}`;await tx`update app.parameters set is_published=false where code='style_reason'`;});
  const publicBody=await (await app.request('/entities/'+id)).text();ok(publicBody.includes('PUBLIC_STYLE')&&!publicBody.includes('PRIVATE_CELL')&&!publicBody.includes('PRIVATE_CORPUS'),'nested cell private');
  await transaction(actor.id,async tx=>{await tx`update app.parameters set is_published=true where code='style_reason'`;});
  console.log('PASS: preservation, permissions, snapshots, nested cells, search, thematic search, full corpus, proposals, conflict');
 }finally{globalThis.fetch=original;await new Promise(r=>setTimeout(r,150));await closePool();}
}});
