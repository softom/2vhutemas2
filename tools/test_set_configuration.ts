import '../api/src/lib/json.ts';
import {Hono} from 'hono';
import {sql,transaction,closePool} from '../api/src/lib/db.ts';
import {parameterSets} from '../api/src/routes/parameters.ts';
import {ApiError} from '../api/src/lib/errors.ts';
import {researchSet,analyzeSet} from '../api/src/lib/setResearch.ts';
import {researchQueries} from '../api/src/lib/researchQueries.ts';
import {analysisPlan} from '../api/src/lib/researchBudget.ts';
import {readSetConfiguration,updateSetConfiguration} from '../api/src/lib/setConfiguration.ts';
import type {AppEnv} from '../api/src/lib/http.ts';
if(Deno.env.get('APP_API_DB_NAME')!=='codex_setconfig_0063')throw Error('Isolated database required');
let count=0;function ok(x:any,message:string){if(!x)throw Error(message);count++;}
const [actor]=await sql<any>`select id from app.contributors limit 1`;
const app=new Hono<AppEnv>();app.use('*',async(c,next)=>{c.set('principal',c.req.header('x-guest')?null:{authUid:actor.id,contributorId:actor.id,displayName:'Test',status:'active',permissions:new Set(['su','edit','create_delete'])});await next();});app.route('/sets',parameterSets);app.onError((e,c)=>{console.error(e.message);return c.json({error:e.message},e instanceof ApiError?e.status:500);});
async function req(path:string,method='GET',body?:any,status=200,guest=false){const r=await app.request(path,{method,headers:{'Content-Type':'application/json',...(guest?{'x-guest':'1'}:{})},body:body?JSON.stringify(body):undefined});const data=await r.json();ok(r.status===status,JSON.stringify(data)+' status '+r.status+' expected '+status);return data as any;}
const old=JSON.stringify(await sql`select id,snapshot from app.revisions order by id`);
const sets=await req('/sets'),style=sets.items.find((s:any)=>s.code==='style_solutions'),basic=sets.items.find((s:any)=>s.research_enabled&&s.result_kind==='parameter_values'&&s.items.some((i:any)=>i.value_type==='text'));
ok(style.result_kind==='relations'&&style.research_tasks.length===1,'style task');ok(style.items.filter((i:any)=>i.result_slot).length===7,'relation slots');
await req('/sets/'+style.id+'/config','GET',undefined,401,true);
let config=await readSetConfiguration(basic.id),member=config.items[0];
const changed=await updateSetConfiguration(basic.id,{config_version:config.set.config_version,items:[{parameter_id:member.parameter_id,label_override:'Test label',hint:'keep me'}]},actor.id);
ok(Number(changed.set.config_version)>Number(config.set.config_version),'version advances');
const [history]=await sql<any>`select snapshot from app.parameter_set_config_revisions where set_id=${basic.id} and version=${config.set.config_version}`;ok(history.snapshot.items[0].label_override===member.label_override,'immutable old snapshot');
await req('/sets/'+basic.id+'/config','PATCH',{config_version:config.set.config_version,set:{research_enabled:false}},409);
await req('/sets/'+basic.code+'/items','PUT',{items:[{parameter:member.parameter_id}]});
config=await readSetConfiguration(basic.id);ok(config.items.find((i:any)=>i.parameter_id===member.parameter_id).hint==='keep me','legacy reorder retains hint');ok(config.items.length===changed.items.length,'legacy partial list retains other items');
const p=await researchSet(style.id);ok(p.task.instruction.length>100,'task loaded');
const queries=researchQueries({title_ru:'Торрес',title_en:'Torres de Colon',title_original:'Torres de Colón',original_language:'es'},p as any);ok(queries.length===6,'three languages');ok(queries.some(q=>q.language==='es'&&q.query.includes('estilo')),'Spanish profile');
const [clone]=await transaction(actor.id,async tx=>tx<any>`insert into app.parameter_sets(code,title_ru,research_enabled,result_kind) values(${'test_'+crypto.randomUUID().replaceAll('-','')},'Новый набор без ветви кода',true,'parameter_values') returning id,config_version`);
let custom=await updateSetConfiguration(clone.id,{config_version:clone.config_version,tasks:[{title:'Проверка',instruction:'TEST_CONFIG_INSTRUCTION',max_calls:1,max_source_chars:2000}],profiles:[{language_tag:'ru',title_source:'title_ru',query_template:'{title} TEST_PROFILE',topic_terms:['unusual']} ]},actor.id);
const newSet=await researchSet(clone.id);ok(researchQueries({title_ru:'Тест'},newSet as any)[0].query==='Тест TEST_PROFILE','new set works only from data');
const sources=Array.from({length:10},(_,i)=>({source_uid:crypto.randomUUID(),source_url:'https://example.org/'+i,source_title:'Тест',source_text:'Тест unusual. '.repeat(1000),source_observations:'[]'}));
const plan=analysisPlan(sources,newSet,['Тест']);ok(plan.chunks.length<=1&&plan.summary.selected_chars<=2000,'configured budget bounded');
try{await updateSetConfiguration(clone.id,{config_version:custom.set.config_version,tasks:[{title:'bad',instruction:'x',max_calls:100}]},actor.id);throw Error('accepted invalid budget');}catch(e){ok(!String(e).includes('accepted invalid'),'budget rejected');}
const afterBad=await readSetConfiguration(clone.id);ok(afterBad.tasks.length===1,'failed edit atomic');
custom=await updateSetConfiguration(clone.id,{config_version:afterBad.set.config_version,tasks:[{title:'Second task',instruction:'SECOND'}]},actor.id);
try{await researchSet(clone.id);throw Error('accepted ambiguous task');}catch(e){ok(String(e).includes('Выберите задание'),'task choice required');}
ok((await researchSet(clone.id,custom.tasks[1].id)).task.id===custom.tasks[1].id,'explicit task');
ok(JSON.stringify(await sql`select id,snapshot from app.revisions order by id`)===old,'entity history untouched');
let current=await readSetConfiguration(basic.id);
const edit=await req('/sets/'+basic.id,'PATCH',{title_ru:current.set.title_ru,config_version:current.set.config_version});
await req('/sets/'+basic.id,'PATCH',{title_ru:'STALE',config_version:current.set.config_version},409);
await req('/sets/'+basic.id+'/items','PUT',{items:[],config_version:current.set.config_version},409);
await req('/sets/'+basic.id+'/items','PUT',{items:[],config_version:edit.config_version,remove_ids:[member.parameter_id]});
current=await readSetConfiguration(basic.id);ok(!current.items.some((i:any)=>i.parameter_id===member.parameter_id),'explicit detach removes only membership');
ok(current.items.length===changed.items.length-1,'other memberships retained');
await req('/sets/'+basic.id+'/items','PUT',{items:[{parameter:member.parameter_id}]});
const revs=await sql<any>`select s.id,s.config_version,r.version from app.parameter_sets s left join app.parameter_set_config_revisions r on r.set_id=s.id and r.version=s.config_version`;ok(revs.every(r=>r.version),'every config version has snapshot');
console.log('SET_CONFIG_INTEGRATION_OK',count);await closePool();
