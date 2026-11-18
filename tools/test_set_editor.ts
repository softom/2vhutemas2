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

const original=JSON.stringify(await sql`select id,snapshot from app.revisions order by id`);
await req('/sets/config/options','GET',undefined,401,true);
const choices=await req('/sets/config/options');ok(choices.types.length&&choices.roles.length,'choices');
const [param]=await sql<any>`select id from app.parameters where value_type='text' limit 1`;
const code='editor_'+crypto.randomUUID().replaceAll('-','');
const draft={code,set:{title_ru:'UI test',note:'keep',card_side:'left',research_enabled:true,result_kind:'parameter_values'},branches:[choices.types[0].id],add_item_ids:[param.id],items:[{parameter_id:param.id,label_override:'Caption',hint:'Hint',input_kind:'textarea',fill_instruction:'Fill carefully'}],tasks:[{title:'Task',instruction:'TEST',max_calls:1,max_source_chars:2000}],profiles:[{language_tag:'en',title_source:'title_en',query_template:'{title} architecture',topic_terms:['architecture']}]};
await req('/sets/config','POST',draft,401,true);
let config=await req('/sets/config','POST',draft,201);const id=config.set.id;
ok(config.items.length===1&&config.items[0].label_override==='Caption'&&config.branches[0]===choices.types[0].id,'atomic create with membership');
ok(config.tasks.length===1&&config.profiles.length===1,'task profiles created');
const before=JSON.stringify(config);
await req('/sets/'+id+'/config','PATCH',{config_version:config.set.config_version,set:{title_ru:'Must rollback'},remove_item_ids:[param.id],tasks:[{title:'bad',instruction:''}]},400);
config=await req('/sets/'+id+'/config');ok(JSON.stringify(config)===before,'all writes rolled back');
await req('/sets/config','POST',{...draft,code:code+'_bad',tasks:[{title:'bad',instruction:''}]},400);
const [bad]=await sql<any>`select count(*)::int as n from app.parameter_sets where code=${code+'_bad'}`;ok(bad.n===0,'failed creation leaves no empty set');
let next=await req('/sets/'+id+'/config','PATCH',{config_version:config.set.config_version,set:{title_ru:'Edited',note:null},branches:[],items:[{parameter_id:param.id,hint:'Changed'}],tasks:[{...config.tasks[0],enabled:false}],profiles:[{...config.profiles[0],enabled:false}]});
ok(next.set.note===null&&next.branches.length===0&&next.items[0].hint==='Changed','atomic update clears note and branches');
ok(next.tasks.length===1&&!next.tasks[0].enabled&&!next.profiles[0].enabled,'disabled history preserved');
await req('/sets/'+id+'/config','PATCH',{config_version:config.set.config_version,set:{title_ru:'Stale'}},409);
next=await req('/sets/'+id+'/config','PATCH',{config_version:next.set.config_version,remove_item_ids:[param.id]});ok(!next.items.length,'explicit detach');
ok(JSON.stringify(await sql`select id,snapshot from app.revisions order by id`)===original,'entity revisions untouched');
console.log('SET_EDITOR_INTEGRATION_OK',count);await closePool();
