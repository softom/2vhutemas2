import '../api/src/lib/json.ts';
import {Hono} from 'hono';
import {sql,transaction,closePool} from '../api/src/lib/db.ts';
import {createRecord,setAnswers,saveRevision,createLink} from '../api/src/lib/records.ts';
import {publishOwned} from '../api/src/lib/ownedVersions.ts';
import {materials} from '../api/src/routes/materials.ts';
import {entities} from '../api/src/routes/entities.ts';
import {ApiError} from '../api/src/lib/errors.ts';
import type {AppEnv} from '../api/src/lib/http.ts';
if(Deno.env.get('APP_API_DB_NAME')!=='codex_fulltext_0062')throw Error('Test database required');
const [actor]=await sql<any>`select id from app.contributors limit 1`;
let count=0;const ok=(v:any,m:string)=>{if(!v)throw Error(m);count++};
const app=new Hono<AppEnv>();app.use('*',async(c,next)=>{c.set('requestId','publication-test');c.set('principal',c.req.header('x-guest')?null:{authUid:actor.id,contributorId:actor.id,displayName:'Test',status:'active',permissions:new Set(['su','edit','publish','review','create_delete'])});await next()});app.route('/materials',materials);app.route('/entities',entities);app.onError((e,c)=>c.json({message:e.message},e instanceof ApiError?e.status:500));
async function req(path:string,body:any,status=200,guest=false){const r=await app.request(path,{method:'POST',headers:{'Content-Type':'application/json',...(guest?{'x-guest':'1'}:{})},body:JSON.stringify(body)});const b=await r.json();ok(r.status===status,JSON.stringify(b)+' expected '+status+' got '+r.status);return b}
globalThis.fetch=async()=>Response.json({ok:true});
async function fixture(){return transaction(actor.id,async tx=>{
 const parent=await createRecord(tx,{type:'architecture_object',title:'Publication test '+crypto.randomUUID(),contributorId:actor.id});
 const concept=await createRecord(tx,{type:'art_styles',title:'Test concept '+crypto.randomUUID(),contributorId:actor.id});const cr=await saveRevision(tx,concept.id,actor.id,'Test');await publishOwned(tx,{entity_id:concept.id,link_id:null},cr);
 const source=await createRecord(tx,{type:'web_page',title:'Test source',contributorId:actor.id});await setAnswers(tx,source.id,[{code:'url',text:'https://example.org/test'}]);const sr=await saveRevision(tx,source.id,actor.id,'Test');await publishOwned(tx,{entity_id:source.id,link_id:null},sr);
 const link=await createLink(tx,{from:parent.id,to:concept.id,role:'classification_membership',justification:'Test rationale',contributorId:actor.id});
 const body=[{type:'paragraph',content:[{type:'text',text:'Test rationale'}]},{type:'quote',content:[{type:'text',text:'Exact source quote'},{type:'sourceRef',props:{entityId:String(source.id),sourceRevisionId:sr,occurrenceId:crypto.randomUUID()}}]}];
 const [lr]=await tx<any>`insert into app.revisions(material_id,base_revision_id,edited_by,operation,snapshot) select m.id,l.working_revision_id,${actor.id},'edit',${JSON.stringify({body_json:body})}::jsonb from app.links l join app.materials m on m.link_id=l.id where l.id=${link} returning id`;
 const other=await createLink(tx,{from:parent.id,to:concept.id,role:'classification_negation',justification:'Unaccepted',contributorId:actor.id});
 await setAnswers(tx,parent.id,[{code:'research_state',text:JSON.stringify({accepted_attributions:[{link_id:link,revision_id:lr.id}]})}]);const revision=await saveRevision(tx,parent.id,actor.id,'Test accepted manifest');return {...parent,revision,link,linkRevision:lr.id,other,source:source.id,concept:concept.id};
})}
async function states(f:any){return sql<any>`select e.status as entity_status,l.status as link_status,l.published_revision_id,(select status from app.links where id=${f.other}) as other_status from app.entities e join app.links l on l.id=${f.link} where e.id=${f.id}`}
const f=await fixture();await req('/materials/'+f.materialId+'/publish',{revision_id:f.revision},401,true);await req('/materials/'+f.materialId+'/publish',{revision_id:f.revision});let [s]=await states(f);ok(s.entity_status==='published'&&s.link_status==='published'&&s.published_revision_id===f.linkRevision,'material publishes accepted link');ok(s.other_status==='draft','unaccepted link untouched');
const [reviews]=await sql<any>`select count(*)::int as n from app.revision_reviews where revision_id=${f.linkRevision} and decision='published'`;ok(reviews.n===1,'one link publication audit');
const g=await fixture();await req('/entities/'+g.id+'/publish',{revision_id:g.revision});[s]=await states(g);ok(s.link_status==='published','entity route uses same manifest');
const h=await fixture();await req('/materials/'+h.materialId+'/review',{decision:'approved'});[s]=await states(h);ok(s.link_status==='published','review uses same manifest');
const bad=await fixture();await sql`update app.entities set status='draft',published_revision_id=null where id=${bad.concept}`;await req('/materials/'+bad.materialId+'/publish',{revision_id:bad.revision},400);[s]=await states(bad);ok(s.entity_status==='draft'&&s.link_status==='draft','missing dependency aborts whole publication');
const changed=await fixture();await transaction(actor.id,tx=>tx`insert into app.revisions(material_id,base_revision_id,edited_by,operation,snapshot) select m.id,l.working_revision_id,${actor.id},'edit',r.snapshot from app.links l join app.materials m on m.link_id=l.id join app.revisions r on r.id=l.working_revision_id where l.id=${changed.link}`);await req('/materials/'+changed.materialId+'/publish',{revision_id:changed.revision},409);[s]=await states(changed);ok(s.entity_status==='draft'&&s.link_status==='draft','changed accepted link aborts whole publication');
console.log('ATTRIBUTION_PUBLICATION_OK',count);await closePool();
