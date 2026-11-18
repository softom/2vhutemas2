import '../src/lib/json.ts';
import {Hono} from 'hono';
import {classification} from '../src/routes/classification.ts';
import {entities} from '../src/routes/entities.ts';
import {links} from '../src/routes/links.ts';
import {sql,transaction,closePool} from '../src/lib/db.ts';
import {researchData,saveResearch,researchSet,analyzeSet} from '../src/lib/setResearch.ts';
import {attributionProposal,classificationCatalog} from '../src/lib/classification.ts';
import {ApiError} from '../src/lib/errors.ts';
import type {Principal} from '../src/lib/auth.ts';
import type {AppEnv} from '../src/lib/http.ts';
if(Deno.env.get('APP_API_DB_NAME')!=='codex_classification_0062')throw new Error('Isolated database only');
let checks=0;function ok(x:unknown,m:string){if(!x)throw new Error(m);checks++;}
const [actor]=await sql<any>`select id from app.contributors limit 1`;
const principal:Principal={authUid:actor.id,contributorId:actor.id,displayName:'Test',status:'active',permissions:new Set(['su','edit','create_delete','publish'])};
const app=new Hono<AppEnv>();app.use('*',async(c,next)=>{c.set('principal',c.req.header('x-guest')?null:principal);await next();});app.onError((e,c)=>{if(!(e instanceof ApiError))console.error(e);return c.json({error:e.message},e instanceof ApiError?e.status:500);});app.route('/classification',classification);app.route('/entities',entities);app.route('/links',links);
async function req(path:string,method='GET',body?:unknown,guest=false,status=200){const r=await app.request(path,{method,headers:{'Content-Type':'application/json',...(guest?{'x-guest':'1'}:{})},...(body?{body:JSON.stringify(body)}:{})});const text=await r.text();ok(r.status===status,`${method} ${path}: ${r.status} expected ${status}: ${text}`);return text?JSON.parse(text):null;}
const old=await sql<any>`select id,snapshot from app.revisions order by id`;const baseline=JSON.stringify(old);
const [modernBefore]=await sql<any>`select * from app.entities where id=1769`;
await req('/classification/initialize','POST',{},true,401);
const seed=await req('/classification/initialize','POST',{});ok(seed.items.some((x:any)=>x.id===1769&&!x.created),'Modernism reused');
const again=await req('/classification/initialize','POST',{});ok(again.items.every((x:any)=>!x.created),'Idempotent seed');
const [modernAfter]=await sql<any>`select * from app.entities where id=1769`;ok(JSON.stringify(modernBefore)===JSON.stringify(modernAfter),'Existing 1769 unchanged');
const catalog=(await req('/classification/library')).items;ok(new Set(catalog.map((c:any)=>c.axis)).size===4,'Four independent axes');
const publicCatalog=(await req('/classification/library','GET',undefined,true)).items;ok(publicCatalog.every((c:any)=>c.is_published),'Draft concepts hidden from public library');
const method=catalog.find((c:any)=>c.axis==='form_method');
const named=await req('/entities','POST',{type:'form_method',title_ru:'Тест имён',title_en:'Names fixture',slug:'names-fixture-'+crypto.randomUUID(),indicators:[{title:'Имена',is_current:true,values:[{parameter:'concept_names',rows:[{concept_name_language:'es',concept_name_text:'Método de prueba',concept_name_kind:'перевод'}]}]}]},false,201);
const names=(await req('/classification/library')).items.find((c:any)=>c.id===named.id);ok(names.names[0].concept_name_language==='es'&&names.title_en==='Names fixture','Language-tagged names retain single entity ID');

const obj=await req('/entities','POST',{type:'architecture_object',title_ru:'Classification test',slug:'classification-test-'+crypto.randomUUID()},false,201);
const [set]=await sql<any>`select id from app.parameter_sets where code='style_solutions'`;
const source={source_uid:crypto.randomUUID(),source_url:'https://example.org/citation-'+crypto.randomUUID(),source_title:'Test source',source_text:'This object uses suspended floors. Its structural design determines the form. Another precise statement about architecture.',source_excerpt:'This object uses suspended floors.',source_fetched:'2026-11-18T00:00:00Z'};
const raw={axis:'art_epochs',concept_id:1769,candidate_name:'',relation:'classification_membership',source_id:source.source_uid,quote:'This object uses suspended floors.',rationale:'Editorial fixture justification',phase:'1976',zone:'body',locator:'Section 1'};
const proposal=attributionProposal(raw,catalog,[source]);
const unknown=attributionProposal({...raw,concept_id:null,candidate_name:'Unknown school'},catalog,[source]);ok(unknown.concept_id===null&&!unknown.selected,'Unknown names remain unselected candidates');
const p2=attributionProposal({...raw,axis:'form_method',concept_id:Number(method.id),relation:'influence'},catalog,[source]);
function reject(p:any){try{attributionProposal(p,catalog,[source]);throw new Error('Validator accepted invalid proposal');}catch(e){ok((e as Error).message!=='Validator accepted invalid proposal','Invalid proposal rejected');}}
reject({...raw,axis:'form_method'});reject({...raw,quote:'Quotation that is absent.'});reject({...raw,source_id:crypto.randomUUID()});reject({...raw,concept_id:999999999});
let data:any={sources:[source],state:{status:'ready',results:{[set.id]:{mode:'attributions',external_sources_only:true,proposals:[proposal,p2]}}}};
let base=await transaction(actor.id,tx=>saveResearch(tx,obj.id,actor.id,data));
const selections=[{id:proposal.id},{id:p2.id}];
const payload=()=>({set_id:set.id,base_revision_id:base,selections});
await req('/classification/'+obj.id+'/preview','POST',{...payload(),base_revision_id:obj.revision_id},false,409);
await req('/classification/'+obj.id+'/preview','POST',payload(),true,401);
let preview=await req('/classification/'+obj.id+'/preview','POST',payload());ok(preview.items.every((x:any)=>x.action==='create'),'Preview new links');
await req('/classification/'+obj.id+'/accept','POST',payload(),false,409);
let accepted=await req('/classification/'+obj.id+'/accept','POST',{...payload(),expected:preview.items});base=accepted.revision;
ok(accepted.items.length===2,'Two axes accepted');
const sourceRecords=await sql<any>`select e.id,e.status,e.published_revision_id from app.entities e join app.indicators i on i.entity_id=e.id join app.indicator_values v on v.indicator_id=i.id join app.parameters p on p.id=v.parameter_id where p.code='url' and v.text_value=${source.source_url}`;
ok(sourceRecords.length===1&&sourceRecords[0].status==='draft'&&!sourceRecords[0].published_revision_id,'Single shared draft URL source');
const linkRows=await sql<any>`select id,status,published_revision_id from app.links where from_entity_id=${obj.id}`;ok(linkRows.length===2&&linkRows.every((l:any)=>l.status==='draft'&&!l.published_revision_id),'No auto-publication');
const [refs]=await sql<any>`select count(*)::int as n from app.document_entity_refs where revision_id=any(${accepted.items.map((i:any)=>i.revision_id)}::uuid[])`;ok(refs.n===2,'Citations indexed');
preview=await req('/classification/'+obj.id+'/preview','POST',payload());ok(preview.items.every((x:any)=>x.action==='repeat'),'Repeated source detected');
accepted=await req('/classification/'+obj.id+'/accept','POST',{...payload(),expected:preview.items});base=accepted.revision;
ok((await sql`select id from app.links where from_entity_id=${obj.id}`).length===2,'No duplicate votes');
data=await researchData(sql,obj.id);data.state.results[set.id].proposals[0].quote='Another precise statement about architecture.';data.state.results[set.id].proposals[0].rationale='Additional interpretation';
base=await transaction(actor.id,tx=>saveResearch(tx,obj.id,actor.id,data));
preview=await req('/classification/'+obj.id+'/preview','POST',{...payload(),selections:[selections[0]]});ok(preview.items[0].action==='append'&&preview.items[0].before.includes(raw.quote),'Preview preserves old quote');
accepted=await req('/classification/'+obj.id+'/accept','POST',{...payload(),selections:[selections[0]],expected:preview.items});base=accepted.revision;
const [body]=await sql<any>`select r.snapshot->'body_json' as blocks from app.links l join app.revisions r on r.id=l.working_revision_id where l.id=${accepted.items[0].link_id}`;
ok(JSON.stringify(body.blocks).includes(raw.quote)&&JSON.stringify(body.blocks).includes('Another precise statement'),'Append retains old author text');
// Link changes between preview and acceptance must cause a conflict.
preview=await req('/classification/'+obj.id+'/preview','POST',{...payload(),selections:[selections[0]]});
const current=preview.items[0];
await req('/links/'+current.link_id,'PATCH',{base_revision_id:current.base_link_revision_id,justification:{text:'Concurrent editor comment'}});
await req('/classification/'+obj.id+'/accept','POST',{...payload(),selections:[selections[0]],expected:preview.items},false,409);
// Snippet-only evidence must not be accepted, even if the saved proposal claims page.
data=await researchData(sql,obj.id);data.sources[0].source_text='';data.sources[0].source_excerpt=raw.quote;data.state.results[set.id].proposals[0].quote=raw.quote;
base=await transaction(actor.id,tx=>saveResearch(tx,obj.id,actor.id,data));
await req('/classification/'+obj.id+'/preview','POST',{...payload(),selections:[selections[0]]},false,400);
// Exercise the real analysis request builder/validator with a local response; no paid request.
const originalFetch=globalThis.fetch;let prompt:any;
globalThis.fetch=async(_url:any,init:any)=>{prompt=JSON.parse(init.body);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({proposals:[{...raw,fragment_id:JSON.parse(prompt.messages[1].content).sources[0].fragment_id},{...raw,fragment_id:-1}]})}}]}),{status:200});};
const analysis=await analyzeSet('Fixture',await researchSet(set.id),[source],{contributorId:actor.id,visitorKey:null,requestId:crypto.randomUUID()});globalThis.fetch=originalFetch;
ok(analysis.mode==='attributions'&&analysis.proposals.length===1&&analysis.rejected===1,'Real analysis schema and quote validator');ok(prompt.response_format.json_schema.name==='classification_attributions'&&JSON.parse(prompt.messages[1].content).catalog.some((c:any)=>c.title_en),'Multilingual catalog reaches model');
ok(JSON.stringify(await sql`select id,snapshot from app.revisions where id=any(${old.map((r:any)=>r.id)}::uuid[]) order by id`)===baseline,'All pre-existing snapshots preserved');
await Deno.writeTextFile('/tmp/library.json',JSON.stringify({items:catalog,axes:(await req('/classification/library')).axes}));
await Deno.writeTextFile('/tmp/integration-passed.json',JSON.stringify({checks,library:true,quotes:true,acceptance:true,idempotency:true,privacy:true,preserved:true,mocked_llm:true}));console.log('CLASSIFICATION_CHECKS',checks);await closePool();
