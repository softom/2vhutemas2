import './json.ts';
import {researchData} from './setResearch.ts';
import { storeExternalDescriptions } from './entityExternalDescriptions.ts';
import { runResearch } from './intakeResearch.ts';
import { closePool,sql,transaction } from './db.ts';

const assert=(v:unknown)=>{if(!v)throw new Error('assertion failed');};
Deno.test({name:'external URLs retain observations; failed analysis retains search sources',sanitizeOps:false,sanitizeResources:false,fn:async()=>{
 assert(Deno.env.get('APP_API_DB_NAME')==='codex_set_research_0058');
 const originalFetch=globalThis.fetch;
 try{
  const [d]=await sql<any>`select id,target_entity_id from app.entity_intake where target_entity_id is not null order by created_at desc limit 1`;
  const [other]=await sql<any>`select id from app.entities where id<>${d.target_entity_id} limit 1`;
  const source={id:crypto.randomUUID(),url:'https://example.org/'+crypto.randomUUID()+'/#fragment',title:'First title',excerpt:'First evidence',provider:'fixture',evidence:'snippet'};
  const research={job:crypto.randomUUID(),sources:[source]};
  await transaction(null,tx=>storeExternalDescriptions(tx,Number(d.target_entity_id),d.id,research));
  await transaction(null,tx=>storeExternalDescriptions(tx,Number(d.target_entity_id),d.id,research));
  const rows=(await researchData(sql,Number(d.target_entity_id))).sources;
  const row=rows.find((r:any)=>r.source_url===source.url.replace('/#fragment',''));
  assert(row&&JSON.parse(row.source_observations).length===1&&row.source_excerpt==='First evidence');
  await transaction(null,tx=>storeExternalDescriptions(tx,Number(d.target_entity_id),d.id,{job:crypto.randomUUID(),sources:[{...source,excerpt:'Second evidence'}]}));
  const updated=(await researchData(sql,Number(d.target_entity_id))).sources.find((r:any)=>r.source_uid===row.source_uid);
  assert(JSON.parse(updated.source_observations).length===2&&JSON.parse(updated.source_observations)[0].excerpt==='First evidence'&&updated.source_excerpt==='Second evidence');
  await transaction(null,tx=>storeExternalDescriptions(tx,Number(other.id),d.id,research));
  assert((await researchData(sql,Number(other.id))).sources.some((r:any)=>r.source_url===row.source_url));
  const grants=await sql<any>`select has_table_privilege('anon','app.entity_external_descriptions','select') as anon,has_table_privilege('authenticated','app.entity_external_descriptions','insert') as authenticated`;
  assert(!grants[0].anon&&!grants[0].authenticated);

  globalThis.fetch=(input:any)=>{
   const url=String(input);
   if(url.endsWith('/chat/completions'))return Promise.resolve(new Response('Unavailable',{status:503}));
   if(url.includes('wikipedia.org'))return Promise.resolve(Response.json({query:{search:[]}}));
   if(url.includes('openalex.org'))return Promise.resolve(Response.json({results:[]}));
   return Promise.resolve(new Response('Unavailable',{status:503}));
  };
  const result=await runResearch({id:d.id,sketch:{title:'Fixture',description:'Fixture',sources:[{url:'https://example.org/retained',title:'Retained',description:'Collected evidence'}]},sources:[]},{contributorId:null,visitorKey:null,requestId:crypto.randomUUID()},crypto.randomUUID());
  assert(result.state==='error'&&result.sources.length===1&&result.sources[0].excerpt==='Collected evidence');
 }finally{globalThis.fetch=originalFetch;await new Promise(r=>setTimeout(r,100));await closePool();}
}});
