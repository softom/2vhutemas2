import {collectResearch,analyzeResearch} from './intakeResearch.ts';
import {gather,analyzeSet,researchData} from './setResearch.ts';
import {SELF_SOURCE_STATUS,isOwnResearchSource} from './researchSourcePolicy.ts';
import {closePool} from './db.ts';
const ok=(v:unknown,m:string)=>{if(!v)throw new Error(m);};
Deno.test({name:'Own pages excluded from collection, retrieval, both LLM paths and saved results',sanitizeOps:false,sanitizeResources:false,fn:async()=>{
 ok(Deno.env.get('APP_API_DB_NAME')==='codex_detach_0060','Isolated database only');
 const original=globalThis.fetch;const caller={contributorId:null,visitorKey:null,requestId:crypto.randomUUID()};
 let llmCalls=0;const retrieved:string[]=[];
 const own={source_uid:'own',source_url:'https://2vhutemas.ru/entities/3121',source_text:'SELF_PRIVATE_MARKER',source_excerpt:'SELF_PRIVATE_MARKER'};
 const external={source_uid:'outside',source_url:'https://example.org/source',source_text:'Independent evidence'};
 const redirected={source_uid:'redirected',source_url:'https://example.org/redirect',source_text:''};
 const set={id:crypto.randomUUID(),code:'style_solutions',title_ru:'Styles',parameters:[{id:crypto.randomUUID(),code:'summary',title_ru:'Summary',value_type:'text'}]};
 try{
 globalThis.fetch=async(input:any,init?:RequestInit)=>{
  const url=String(input);
  if(url.includes('yandex.net'))return Response.json({rawData:btoa('<doc><url>https://2vhutemas.ru/entities/3121</url><title>Own</title><passage>SELF_PRIVATE_MARKER</passage></doc><doc><url>https://example.org/source</url><title>External</title><passage>Independent evidence</passage></doc>')});
  if(url.includes('wikipedia.org'))return Response.json({query:{search:[]}});
  if(url.includes('openalex.org'))return Response.json({results:[]});
  if(url.includes('duckduckgo.com'))return new Response('');
  if(url.startsWith('https://r.jina.ai/')){retrieved.push(url);return new Response('URL Source: https://2vhutemas.ru/redirected\nSELF_PRIVATE_MARKER');}
  if(url.endsWith('/chat/completions')){
   llmCalls++;const body=JSON.parse(String(init?.body));const ctx=JSON.parse(body.messages[1].content);
   ok(ctx.sources.length===1,'Only independent source in context');ok(!JSON.stringify(ctx.sources).includes('SELF_PRIVATE_MARKER'),'No own text in LLM');
   return Response.json({choices:[{message:{content:JSON.stringify({proposals:[],summary:'External only',consensus:'unknown',phases:[],findings:[]})}}]});
  }
  throw new Error('Unexpected external request: '+url);
 };
 const d={id:'test',sketch:{title:'Building',description:'',sources:[{url:own.source_url,description:own.source_text}]},sources:[]};
 const found=await collectResearch(d,caller);ok(found.sources.length===1&&!found.sources.some(s=>isOwnResearchSource(s.url)),'Collection filter');
 const gathered=await gather('Building',set,[own,external,redirected],caller);
 ok(gathered.sources.find(s=>s.source_uid==='own')?.source_status===SELF_SOURCE_STATUS,'Archived own row marked');
 ok(gathered.sources.find(s=>s.source_uid==='redirected')?.source_status===SELF_SOURCE_STATUS,'Extractor final source checked');
 ok(retrieved.length===1&&!retrieved[0].includes('2vhutemas.ru'),'Own page not fetched');
 const result=await analyzeSet('Building',set,gathered.sources,caller);ok(result.external_sources_only&&result.warnings.length,'Set analysis filters archive');
 const sourceRows=[{id:'own',url:own.source_url,title:'Own',excerpt:own.source_text,provider:'test',evidence:'snippet' as const},{id:'outside',url:external.source_url,title:'External',excerpt:external.source_text,provider:'test',evidence:'snippet' as const}];
 await analyzeResearch(d,caller,'test',sourceRows,[],[]);
 for(const fn of [()=>analyzeSet('Building',set,[own],caller),()=>analyzeResearch(d,caller,'test',sourceRows.slice(0,1),[],[])]){
  let rejected=false;try{await fn();}catch{rejected=true;}ok(rejected,'All-own corpus rejected');
 }
 ok(llmCalls===2,'No paid request for empty external corpus');
 const saved=await researchData((async()=>[{code:'research_sources',rows:[own,external]},{code:'research_state',text_value:JSON.stringify({results:{old:{proposals:[{}]},new:{external_sources_only:true,proposals:[]}}})}]) as any,3121);
 ok(!saved.state.results.old&&saved.state.results.new,'Old contaminated results hidden; new result retained');
 ok(saved.sources.length===2&&saved.sources[0].source_text===own.source_text,'Historical corpus retained');
 }finally{globalThis.fetch=original;await new Promise(r=>setTimeout(r,200));await closePool();}
}});
