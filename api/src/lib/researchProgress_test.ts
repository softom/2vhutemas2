import {analyzeSet,researchSet} from './setResearch.ts';
import {sql,closePool} from './db.ts';
const ok=(v:unknown,m:string)=>{if(!v)throw new Error(m);};
Deno.test({name:'Research progress and precise validation reasons survive mixed model output',sanitizeOps:false,sanitizeResources:false,fn:async()=>{
 ok(Deno.env.get('APP_API_DB_NAME')==='codex_detach_0060','Isolated DB only');
 const original=globalThis.fetch;const events:any[]=[];
 try{
 const [row]=await sql<any>`select id from app.parameter_sets where code='style_solutions'`;const set=await researchSet(row.id);
 globalThis.fetch=async(input:any)=>{
  if(!String(input).endsWith('/chat/completions'))throw new Error('Unexpected external call');
  return Response.json({choices:[{message:{content:JSON.stringify({proposals:[
   {parameter_id:'wrong',value:[],source_ids:['source']},
   {parameter_id:set.parameters[0].id,value:[{style_name:['wrong array']}],source_ids:['source']},
   {parameter_id:set.parameters[0].id,value:[{style_name:'Gothic'}],source_ids:['source']}
  ]})}}]});
 };
 const result=await analyzeSet('Building',set,[{source_uid:'source',source_url:'https://example.org/source',source_excerpt:'Gothic',source_status:'Ошибка получения: HTTP 451'}],{contributorId:null,visitorKey:null,requestId:crypto.randomUUID()},p=>events.push(p));
 ok(result.received===3&&result.rejected===2&&result.proposals.length===1,'Outcome counts');
 ok(result.warnings.some(w=>w.includes('parameter_id'))&&result.warnings.some(w=>w.includes('ожидается text')),'Precise reasons');
 ok(result.warnings.some(w=>w.includes('HTTP 451')),'Retrieval limitation explicit');
 ok(events.length===2&&events[0].done===0&&events[1].done===1&&events[1].accepted===1&&events[1].rejected===2,'Actual part progress');
 }finally{globalThis.fetch=original;await new Promise(r=>setTimeout(r,200));await closePool();}
}});
