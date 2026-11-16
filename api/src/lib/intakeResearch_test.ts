import { collectResearch, analyzeResearch } from './intakeResearch.ts';
import { closePool,sql } from './db.ts';
const assert=(x:unknown)=>{if(!x)throw new Error('assertion failed');};
Deno.test({name:'fixed-provider collection, UTF8, deduplication, schema and AI audit',sanitizeOps:false,sanitizeResources:false,fn:async()=>{
 assert(Deno.env.get('APP_API_DB_NAME')==='codex_intake_style_test');
 const original=globalThis.fetch;const oldKey=Deno.env.get('YANDEX_API_KEY'),oldFolder=Deno.env.get('YANDEX_FOLDER_ID');
 const caller={contributorId:null,visitorKey:null,requestId:crypto.randomUUID()};
 const calls:string[]=[];
 try{
 Deno.env.set('YANDEX_API_KEY','fixture');Deno.env.set('YANDEX_FOLDER_ID','fixture');
 globalThis.fetch=(input:any,init?:RequestInit)=>{
  const url=String(input);calls.push(url);
  if(url.includes('wikipedia.org'))return Promise.resolve(Response.json({query:{search:[{title:'Башни',snippet:'Конструкция башен'}]}}));
  if(url.includes('openalex.org'))return Promise.resolve(Response.json({results:[{id:'https://example.org/article',title:'Article',abstract_inverted_index:{Evidence:[0]}}]}));
  if(url.includes('duckduckgo.com'))return Promise.resolve(new Response('Unavailable',{status:503}));
  if(url.includes('searchapi.api.cloud.yandex.net')){const xml='<doc><url>https://example.org/russian</url><title>Башни Колумба</title><passage>Подвесная конструкция</passage></doc>';return Promise.resolve(Response.json({rawData:btoa(String.fromCharCode(...new TextEncoder().encode(xml)))}));}
  if(url.endsWith('/chat/completions')){
   const body=JSON.parse(String(init?.body));const user=JSON.parse(body.messages[1].content);
   return Promise.resolve(Response.json({usage:{prompt_tokens:10,completion_tokens:10},choices:[{message:{content:JSON.stringify({summary:'Уточнить фазу',consensus:'split',phases:[],findings:[{kind:'feature',title:'Подвесная конструкция',relation:'positive',level:'конструкция',phase:'1976',zone:'body',rationale:'Есть в корпусе',source_ids:[user.sources[0].id],entity_id:null}]})}}]}));
  }throw new Error('Unexpected destination '+url);
 };
 const d={id:crypto.randomUUID(),sketch:{title:'Torres',description:'Описание',sources:[{url:'https://example.org/article',title:'Авторский материал',description:'Human evidence'}]},sources:[{url:"https://example.org/russian",title:"Пустая ссылка",description:""}]};
 const {sources,warnings}=await collectResearch(d,caller);
 assert(sources.filter(s=>s.url==='https://example.org/article').length===1);
 assert(sources.some(s=>s.title==='Башни Колумба'&&s.excerpt==='Подвесная конструкция'));
 assert(warnings.some(s=>s.includes('Веб-поиск')));
 assert(!calls.some(url=>url.startsWith('https://example.org')));
 const result=await analyzeResearch(d,caller,'job',sources,[],warnings);assert(result.findings.length===1&&!result.findings[0].selected);
 for(let i=0;i<20;i++){const rows=await sql`select id from app.ai_requests where request_id=${caller.requestId}`;if(rows.length>=2)break;await new Promise(r=>setTimeout(r,50));}
 const audit=await sql`select status from app.ai_requests where request_id=${caller.requestId}`;assert(audit.length>=2&&audit.every(r=>r.status==='ok'));
 }finally{
  globalThis.fetch=original;oldKey===undefined?Deno.env.delete('YANDEX_API_KEY'):Deno.env.set('YANDEX_API_KEY',oldKey);oldFolder===undefined?Deno.env.delete('YANDEX_FOLDER_ID'):Deno.env.set('YANDEX_FOLDER_ID',oldFolder);await closePool();
 }
}});
