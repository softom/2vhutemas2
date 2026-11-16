import { Hono } from "hono";
import { sql, transaction, type Tx } from "../lib/db.ts";
import { require as requirePermission, can } from "../lib/auth.ts";
import { ApiError } from "../lib/errors.ts";
import type { AppEnv } from "../lib/http.ts";

import { auditIntake, prepareSketch, publishSketch, cleanText } from "../lib/intakeSketch.ts";
import { callerOf } from "../lib/aiJournal.ts";
import { log } from "../lib/http.ts";
import { relationOptions, relationMatches, validateRelations } from "../lib/intakeRelations.ts";
import { applyDeferredRelations } from "../lib/intakeDeferredRelations.ts";
import { intakeMedia, mediaManifest } from "../lib/intakeMedia.ts";
import catalogs from "../lib/intakeCatalogs.json" with { type: "json" };
import { runResearch } from "../lib/intakeResearch.ts";
import { researchRunning, selectResearch } from "../lib/intakeResearchSchema.ts";
export const entityIntake = new Hono<AppEnv>();
type Row = Record<string, any>;
const statuses = new Set(["proposed", "reviewing", "needs_info", "ready", "done", "rejected"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (message: string): never => { throw new ApiError("validation_failed", message); };
function uuid(v: unknown): string { if (typeof v !== "string" || !uuidPattern.test(v)) fail("Некорректный UID"); return v as string; }
function text(v: unknown, max = 20000): string { if (v == null) return ""; if (typeof v !== "string" || v.length > max) fail("Недопустимый текст или превышена длина"); return (v as string).trim(); }
function uid(v: unknown): number | null { if (v == null || v === "") return null; const n = Number(v); if (!Number.isSafeInteger(n) || n <= 0) fail("Некорректный UID записи"); return n; }
function url(v: unknown): string { const s = text(v, 4000); if (!s) return ""; try { const u = new URL(s); if (!["http:","https:"].includes(u.protocol) || u.username || u.password) fail("Нужна ссылка HTTP/HTTPS без пароля"); } catch { fail("Некорректная ссылка"); } return s; }
function validate(v: Row): Row {
 const status = text(v.status, 30) || "proposed"; if (!statuses.has(status)) fail("Неизвестный статус");
 const title = text(v.title, 500); if (!title) fail("Укажите название досье");
 const reason = text(v.reason); if (["needs_info","rejected"].includes(status) && !reason) fail("Укажите причину решения");
 if (!Array.isArray(v.sources) || !v.sources.length || v.sources.length > 100) fail("Нужен хотя бы один источник (не более 100)");
 const ids = new Set<string>();
 const unique = (id: unknown) => { const s = uuid(id); if (ids.has(s)) fail("Повторяющийся UID в досье"); ids.add(s); return s; };
 const sources = v.sources.map((s: Row) => {
  if (!s || typeof s !== "object") fail("Некорректный источник");
  if (!Array.isArray(s.media) || s.media.length > 100) fail("Некорректный список медиа");
  const media = s.media.map((m: Row) => {
   if (!m || typeof m !== "object") fail("Некорректное медиа");
   const media_entity_id=uid(m.media_entity_id), address=url(m.url);
   const status=media_entity_id ? "stored" : m.status === "error" ? "error" : "link";
   if (!media_entity_id && !address) fail("Медиа требует ссылку или запись медиатеки");
   const error=text(m.error,2000); if(status === "error" && !error) fail("Укажите ошибку получения медиа");
   return {id:unique(m.id),url:address,media_entity_id,kind:text(m.kind,80)||"image",caption:text(m.caption,4000),author:text(m.author,1000),status,error};
  });
  const title=text(s.title,500)||url(s.url),description=text(s.description,60000); if(!title || (!url(s.url) && !description && !media.length)) fail("Добавьте ссылку на источник");
  const date=text(s.published_at,10); if(date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10)!==date)) fail("Некорректная дата источника");
  return {id:unique(s.id),title,description,url:url(s.url),publisher:text(s.publisher,1000),author:text(s.author,1000),published_at:date||null,media};
 });
 return {id:uuid(v.id),title,description:text(v.description,60000),status,reason,target_entity_id:uid(v.target_entity_id),sources};
}
export async function loadIntake(tx: Tx, id: string, lock=false): Promise<Row> {
 const rows = lock ? await tx<Row>`select * from app.entity_intake where id=${id} for update` : await tx<Row>`select * from app.entity_intake where id=${id}`;
 if(!rows.length) throw new ApiError("not_found","Досье не найдено");
 const sources=await tx<Row>`select * from app.entity_intake_sources where intake_id=${id} order by created_at,id`;
 const media=await tx<Row>`select m.* from app.entity_intake_media m join app.entity_intake_sources s on s.id=m.source_id where s.intake_id=${id} order by m.created_at,m.id`;
 const result={...rows[0],sources:sources.map(s=>({...s,published_at:s.published_at ? new Date(s.published_at).toISOString().slice(0,10) : null,media:media.filter(m=>m.source_id===s.id)}))};
 return {...result,publication_media:await intakeMedia(tx,result as any)};
}
entityIntake.use("*", async(c,next)=>{requirePermission(c.get("principal"),"edit");await next();});
entityIntake.get("/", async c=>{
 const q=text(c.req.query("q"),500), status=text(c.req.query("status"),30);
 const page=Math.max(0,Math.min(100000,Number(c.req.query("page"))||0));
 const items=await sql`select d.id,d.title,d.status,d.version,d.updated_at,d.target_entity_id,
 (select count(*)::int from app.entity_intake_sources s where s.intake_id=d.id) as sources_count,
 (select count(*)::int from app.entity_intake_media m join app.entity_intake_sources s on s.id=m.source_id where s.intake_id=d.id) as media_count
 from app.entity_intake d where (${status}='' or (${status}='work' and d.status not in ('ready','done')) or d.status=${status}) and (${q}='' or d.title ilike '%'||${q}||'%') order by d.updated_at desc,d.id limit 30 offset ${Math.floor(page)*30}`;
 const count=await sql<{total:number}>`select count(*)::int as total from app.entity_intake where (${status}='' or (${status}='work' and status not in ('ready','done')) or status=${status}) and (${q}='' or title ilike '%'||${q}||'%')`;
 return c.json({items,total:count[0].total});
});
entityIntake.get("/:id",async c=>c.json(await loadIntake(sql,uuid(c.req.param("id")))));
async function save(c: any, creating: boolean) {
 const actor=requirePermission(c.get("principal"),"edit");
 const raw=await c.req.text(); if(new TextEncoder().encode(raw).length>1000000) throw new ApiError("payload_too_large","Досье больше 1 МБ; разделите материалы");
 let input: Row;try{input=JSON.parse(raw);}catch{fail("Некорректный JSON");}
 if(!input! || typeof input!=="object") fail("Нужно досье");
 const d=validate(input!);if(!creating && d.id!==uuid(c.req.param("id"))) fail("UID не совпадает с адресом");
 const result=await transaction(actor.contributorId,async tx=>{
  // Serializes same-UID POST retries and updates without a duplicate race.
  await tx`select pg_advisory_xact_lock(hashtextextended('entity-intake-write',0))`;
  const exists=await tx`select id from app.entity_intake where id=${d.id}`;
  if(creating && exists.length) return await loadIntake(tx,d.id);
  const old=creating?null:await loadIntake(tx,d.id,true);
  if(old?.sketch?.state === "running" && Date.now()-Date.parse(old.sketch.started_at)<300000) throw new ApiError("version_conflict","Дождитесь подготовки эскиза");
  if(old?.sketch && old.status === "done") fail("Опубликованная карточка редактируется в каталоге");
  if(old && input!.version!==old.version) throw new ApiError("version_conflict","Досье уже изменилось. Откройте сохранённую версию; ваши правки не перезаписаны.");
  if(creating && d.status!=="proposed") fail("Новое досье начинается со статуса «Предложено»");
  if(d.target_entity_id && !(await tx`select id from app.entities where id=${d.target_entity_id} and status <> 'archived'`).length) fail("Целевая запись не найдена или архивирована");
  if(d.status==='done' && (!d.target_entity_id || !d.reason || input!.confirm_done!==true || !old || !['ready','done'].includes(old.status))) fail("Для завершения нужны готовое досье, запись каталога, описание внесённого и подтверждение проверки");
  for(const s of d.sources){
   const owner=await tx<Row>`select intake_id from app.entity_intake_sources where id=${s.id}`;
   if(owner.length && owner[0].intake_id!==d.id) fail("Источник принадлежит другому досье");
   for(const m of s.media){
    const owner=await tx<Row>`select source_id from app.entity_intake_media where id=${m.id}`;
    if(owner.length && owner[0].source_id!==s.id) fail("Медиа принадлежит другому источнику");
    if(m.media_entity_id && !(await tx`select a.id from app.media_assets a join app.media_files f on f.asset_id=a.id where a.entity_id=${m.media_entity_id} and a.archived_at is null and f.variant='original' and f.status='ready' and f.is_current`).length) fail("Файл оригинала не найден в медиатеке");
   }
  }
  if(creating) await tx`insert into app.entity_intake(id,title,description,status,reason,target_entity_id) values(${d.id},${d.title},${d.description},${d.status},${d.reason},${d.target_entity_id})`;
  else {
   const {history,...snapshot}=old!;
   await tx`update app.entity_intake set title=${d.title},description=${d.description},status=${d.status},reason=${d.reason},target_entity_id=${d.target_entity_id},sketch=case when sketch is null then null else sketch || '{"state":"stale"}'::jsonb end,version=version+1,
    history=history||${JSON.stringify([{at:new Date().toISOString(),by:actor.contributorId,snapshot}])}::jsonb where id=${d.id}`;
  }
  // Whole-dossier replacement is atomic; previous content is retained in history.
  const sourceIds=d.sources.map((s:Row)=>s.id),mediaIds=d.sources.flatMap((s:Row)=>s.media.map((m:Row)=>m.id));
  await tx`delete from app.entity_intake_media where source_id in(select id from app.entity_intake_sources where intake_id=${d.id}) and not(id=any(${mediaIds}::uuid[]))`;
  await tx`delete from app.entity_intake_sources where intake_id=${d.id} and not(id=any(${sourceIds}::uuid[]))`;
  for(const s of d.sources){
   await tx`insert into app.entity_intake_sources(id,intake_id,url,title,description,publisher,author,published_at) values(${s.id},${d.id},${s.url},${s.title},${s.description},${s.publisher},${s.author},${s.published_at})
    on conflict(id) do update set url=excluded.url,title=excluded.title,description=excluded.description,publisher=excluded.publisher,author=excluded.author,published_at=excluded.published_at`;
   for(const m of s.media) await tx`insert into app.entity_intake_media(id,source_id,url,media_entity_id,kind,caption,author,status,error) values(${m.id},${s.id},${m.url},${m.media_entity_id},${m.kind},${m.caption},${m.author},${m.status},${m.error})
    on conflict(id) do update set url=excluded.url,media_entity_id=excluded.media_entity_id,kind=excluded.kind,caption=excluded.caption,author=excluded.author,status=excluded.status,error=excluded.error`;
  }
  return await loadIntake(tx,d.id);
 });
 return c.json(result,creating?201:200);
}
entityIntake.post("/",c=>save(c,true));
entityIntake.put("/:id",c=>save(c,false));

// Research of an existing saved revision. Never rewrites the entity or reuses
// a published dossier; retries share the same pending dossier for this revision.
entityIntake.post('/from-entity/:entityId',async c=>{
 const actor=requirePermission(c.get('principal'),'edit');
 const entityId=uid(c.req.param('entityId')),input=await c.req.json();
 const revision=uuid(input.base_revision_id);
 return c.json(await transaction(actor.contributorId,async tx=>{
  await tx`select pg_advisory_xact_lock(hashtextextended(${'entity-research:'+entityId},0))`;
  const rows=await tx<Row>`select e.id,e.title_ru,e.type_id,e.working_revision_id,r.snapshot from app.entities e join app.revisions r on r.id=e.working_revision_id where e.id=${entityId} and e.status <> 'archived' for share of e`;
  if(!rows.length)throw new ApiError('not_found','Запись не найдена или архивирована');
  const e=rows[0];
  if(e.working_revision_id!==revision)throw new ApiError('version_conflict','Сохранённая версия изменилась. Обновите редактор, сохранив свои правки.');
  const existing=await tx<Row>`select id from app.entity_intake where target_entity_id=${entityId} and status='ready' and sketch->>'origin'='entity_research' and sketch->>'target_revision_id'=${revision} and sketch->>'state'='ready' order by created_at desc limit 1`;
  if(existing.length)return await loadIntake(tx,existing[0].id);
  const id=crypto.randomUUID();
  const context=(value:any):string=>Array.isArray(value)?value.map(context).join(' '):value&&typeof value==='object'?[typeof value.text==='string'?value.text:'',context(value.content),context(value.children)].filter(Boolean).join(' '):'';
  const description=context(e.snapshot?.body_json).slice(0,60000);
  const sketch={state:'ready',origin:'entity_research',title:e.title_ru,type_id:e.type_id,
   description:'Исследование стиля и морфологии: '+e.title_ru,sources:[],questions:[],matches:[],related:[],
   target_entity_id:Number(e.id),target_revision_id:revision};
  await tx`insert into app.entity_intake(id,title,description,status,target_entity_id,sketch) values(${id},${e.title_ru},${description},'ready',${entityId},${JSON.stringify(sketch)}::jsonb)`;
  await tx`insert into app.entity_intake_sources(id,intake_id,url,title,description) values(${crypto.randomUUID()},${id},${'https://2vhutemas.ru/entities/'+e.id},${e.title_ru},${description||e.title_ru})`;
  return await loadIntake(tx,id);
 }));
});


entityIntake.get("/options/types",async c=>c.json({items:await sql`select id,title_ru from app.entity_types order by title_ru`}));
entityIntake.get("/options/relations",async c=>c.json({...await relationOptions(),items:await relationMatches(c.req.query('kind')||'author',text(c.req.query('q'),300))}));
entityIntake.get("/options/catalogs",c=>c.json({items:catalogs}));
entityIntake.post("/:id/prepare",async c=>{
 const actor=requirePermission(c.get('principal'),'edit'),caller=await callerOf(c);
 const input=await c.req.json();const id=uuid(c.req.param('id'));const job=crypto.randomUUID();
 const d=await transaction(actor.contributorId,async tx=>{
  const d=await loadIntake(tx,id,true);
  if(d.version!==input.version)throw new ApiError('version_conflict','Стек изменился. Обновите карточку');
  if(d.status==='done')fail('Карточка уже опубликована');
  if(d.sketch?.state==='running'&&Date.now()-Date.parse(d.sketch.started_at)<300000)return d;
  if(d.sketch?.description&&input.replace!==true)fail('Подтвердите повторную подготовку; текущий эскиз сохранится в истории');
  await auditIntake(tx,d,actor.contributorId);
  const sketch={...d.sketch,state:'running',job,started_at:new Date().toISOString()};
  await tx`update app.entity_intake set sketch=${JSON.stringify(sketch)}::jsonb,status='reviewing',version=version+1 where id=${id}`;
  return await loadIntake(tx,id);
 });
 if(d.sketch.job===job)void (async()=>{
  try{
   const sketch=await prepareSketch(d,caller);
   await transaction(actor.contributorId,async tx=>{
    const current=await loadIntake(tx,id,true);if(current.sketch?.job!==job||current.version!==d.version)return;
    await auditIntake(tx,current,actor.contributorId);
    for(const source of sketch.sources)await tx`insert into app.entity_intake_sources(id,intake_id,url,title,description) select ${crypto.randomUUID()},${id},${source.url},${source.title},${source.description} where not exists(select 1 from app.entity_intake_sources where intake_id=${id} and url=${source.url})`;
    await tx`update app.entity_intake set sketch=${JSON.stringify(sketch)}::jsonb,status='ready',version=version+1 where id=${id}`;
   });
  }catch(e){
   log('error',caller.requestId,'Не удалось подготовить эскиз',{intake_id:id,error:String(e)});
   await transaction(actor.contributorId,async tx=>{
    const current=await loadIntake(tx,id,true);if(current.sketch?.job!==job)return;
    await auditIntake(tx,current,actor.contributorId);
    await tx`update app.entity_intake set sketch=sketch||${JSON.stringify({state:'error',error:'Подготовка не завершена. Попробуйте ещё раз; материалы сохранены.'})}::jsonb,status='needs_info',reason='Ошибка подготовки эскиза',version=version+1 where id=${id}`;
   });
  }
 })().catch(e=>log('error',caller.requestId,'Ошибка сохранения результата подготовки',{intake_id:id,error:String(e)}));
 return c.json(d,202);
});
entityIntake.put('/:id/sketch',async c=>{
 const actor=requirePermission(c.get('principal'),'edit'),input=await c.req.json();
 return c.json(await transaction(actor.contributorId,async tx=>{
  const d=await loadIntake(tx,uuid(c.req.param('id')),true);
  if(d.version!==input.version)throw new ApiError('version_conflict','Эскиз изменился. Обновите карточку');
  if(d.status==='done'||d.sketch?.state!=='ready')fail('Эскиз ещё не готов для правки');
  const sk=input.sketch;if(!sk)fail('Нужен эскиз');
  const title=cleanText(sk.title,500),description=cleanText(sk.description);if(!title||!description)fail('Укажите название и описание');
  const type=uuid(sk.type_id);if(!(await tx`select id from app.entity_types where id=${type}`).length)fail('Неизвестный тип');
  const target=uid(sk.target_entity_id);let revision=null;
  if(target){const rows=await tx<Row>`select working_revision_id from app.entities where id=${target} and status <> 'archived'`;if(!rows.length)fail('Запись не найдена');revision=rows[0].working_revision_id;}
  const related=await validateRelations(tx,sk.related||[],d.sketch.related||[],d.sketch.sources,target);
  if(researchRunning(d.sketch.research))throw new ApiError('version_conflict','Дождитесь исследования или повторите после истечения пяти минут');
  let research=selectResearch(d.sketch.research,sk.research_selected_ids);
  if(research?.state==='ready'&&(title!==d.sketch.title||type!==d.sketch.type_id))research={...research,state:'stale',error:'Название или тип объекта изменились. Повторите исследование; прежние выводы сохранены в истории.'};
  const sketch={...d.sketch,research,related,title,description,type_id:type,target_entity_id:target,target_revision_id:target===d.sketch.target_entity_id?d.sketch.target_revision_id:revision};
  await auditIntake(tx,d,actor.contributorId);
  await tx`update app.entity_intake set sketch=${JSON.stringify(sketch)}::jsonb,version=version+1 where id=${d.id}`;
  return await loadIntake(tx,d.id);
 }));
});
entityIntake.post('/:id/approve',async c=>{
 const actor=requirePermission(c.get('principal'),'publish');requirePermission(actor,'edit');
 const input=await c.req.json();if(input.confirm!==true)fail('Подтвердите публикацию просмотренной карточки');
 return c.json(await transaction(actor.contributorId,async tx=>{
  await tx`select pg_advisory_xact_lock(hashtextextended('entity-intake-approval',0))`;
  const d=await loadIntake(tx,uuid(c.req.param('id')),true);
  if(d.status==='done'&&d.sketch?.state==='published'){
   await applyDeferredRelations(tx,d.id,actor.contributorId,can(actor,'create_delete'));
   return await loadIntake(tx,d.id);
  }
  if(d.version!==input.version)throw new ApiError('version_conflict','Эскиз изменился. Проверьте новую версию');
  if(researchRunning(d.sketch?.research))throw new ApiError('version_conflict','Сначала дождитесь исследования');
  if(d.sketch?.target_entity_id) await tx`select id from app.entities where id=${d.sketch.target_entity_id} for update`;
  await tx`select id from app.entities where id=any(${d.publication_media.map((m:Row)=>m.id)}::bigint[]) order by id for update`;
  const expected=mediaManifest(await intakeMedia(tx,d as any));
  if(JSON.stringify(expected)!==JSON.stringify(input.media_manifest ?? []))
   throw new ApiError('version_conflict','Иллюстрации изменились. Обновите эскиз и проверьте состав публикации.');
  if(!d.sketch?.target_entity_id || d.sketch.related?.some((r:Row)=>r.confirmed&&r.kind==='author'))requirePermission(actor,'create_delete');
  await auditIntake(tx,d,actor.contributorId);
  const id=await publishSketch(tx,d,actor.contributorId);
  await tx`update app.entity_intake set target_entity_id=${id},status='done',reason='Эскиз утверждён и опубликован',sketch=sketch||'{"state":"published"}'::jsonb,version=version+1 where id=${d.id}`;
  await applyDeferredRelations(tx,d.id,actor.contributorId,can(actor,'create_delete'));
  return await loadIntake(tx,d.id);
 }));
});

// Persisted job marker + optimistic completion: a stale worker never replaces edits.
entityIntake.post('/:id/research',async c=>{
 const actor=requirePermission(c.get('principal'),'edit'),caller=await callerOf(c);
 const input=await c.req.json(),id=uuid(c.req.param('id')),job=crypto.randomUUID();
 const d=await transaction(actor.contributorId,async tx=>{
  await tx`select pg_advisory_xact_lock(hashtextextended('intake-research-start',0))`;
  const d=await loadIntake(tx,id,true);
  if(d.version!==input.version)throw new ApiError('version_conflict','Эскиз изменился; обновите карточку');
  if(d.status==='done'||d.sketch?.state!=='ready')fail('Сначала подготовьте эскиз');
  if(researchRunning(d.sketch.research))return d;
  if(d.sketch.research?.state==='ready'&&input.replace!==true)fail('Подтвердите новое исследование; прежнее сохранится в истории');
  const count=await tx<{n:number}>`select count(*)::int n from app.entity_intake where sketch->'research'->>'state'='running' and sketch->'research'->>'started_at'>${new Date(Date.now()-300000).toISOString()}`;
  if(count[0].n>=2)throw new ApiError('rate_limited','Уже выполняются два исследования. Повторите позже');
  await auditIntake(tx,d,actor.contributorId);
  const research={state:'running',job,started_at:new Date().toISOString()};
  await tx`update app.entity_intake set sketch=jsonb_set(sketch,'{research}',${JSON.stringify(research)}::jsonb),version=version+1 where id=${id}`;
  return await loadIntake(tx,id);
 });
 if(d.sketch.research.job===job)void(async()=>{
  let result:any;
  try{result=await runResearch(d,caller,job);}catch(e){log('error',caller.requestId,'Ошибка исследования',{intake_id:id,error:String(e)});result={state:'error',job,error:'Исследование не завершено. Материалы и прежний результат в истории сохранены; можно повторить.'};}
  await transaction(actor.contributorId,async tx=>{
   const current=await loadIntake(tx,id,true);if(current.sketch?.research?.job!==job)return;
   await auditIntake(tx,current,actor.contributorId);
   if(current.version!==d.version||current.status==='done')result={state:'error',job,error:'Карточка изменилась во время исследования. Результат не применён; повторите исследование.'};
   const sketch={...current.sketch,research:result};
   await tx`update app.entity_intake set sketch=${JSON.stringify(sketch)}::jsonb,version=version+1 where id=${id}`;
  });
 })().catch(e=>log('error',caller.requestId,'Ошибка сохранения исследования',{intake_id:id,error:String(e)}));
 return c.json(d,202);
});

// A proposal points to a dossier UID until its target entity has been published.
entityIntake.post('/:id/relation-candidate',async c=>{
 const actor=requirePermission(c.get('principal'),'edit'),input=await c.req.json();
 return c.json(await transaction(actor.contributorId,async tx=>{
  const d=await loadIntake(tx,uuid(c.req.param('id')),true);
  if(d.version!==input.version)throw new ApiError('version_conflict','Эскиз изменился. Обновите карточку');
  if(d.status==='done'||d.sketch?.state!=='ready')fail('Нужен редактируемый эскиз');
  const index=input.index;if(!Number.isInteger(index)||index<0||index>=(d.sketch.related||[]).length)fail('Предложение не найдено');
  const r=d.sketch.related[index];if(!['author','place'].includes(r.kind))fail('Сначала укажите тип предложения');
  if(input.resolve===true){
   if(!r.candidate_intake_id)fail('Кандидат не выбран');
   const candidate=await loadIntake(tx,uuid(r.candidate_intake_id));
   if(candidate.status!=='done'||!candidate.target_entity_id)fail('Кандидат ещё не опубликован');
   const changed={...r,entity_id:Number(candidate.target_entity_id),confirmed:false};
   const [checked]=await validateRelations(tx,[changed],[r],d.sketch.sources,d.sketch.target_entity_id);
   d.sketch.related[index]=checked;
  }else{
   if(r.candidate_intake_id)return d;
   if(r.entity_id)fail('К предложению уже прикреплена запись');
   const title=text(r.name,500);if(!title)fail('Укажите название кандидата');
   const candidateId=crypto.randomUUID();
   await tx`insert into app.entity_intake(id,title,description) values(${candidateId},${title},${'Кандидат: '+(r.kind==='place'?'место':'автор')+'. '+(r.reason||'Уточнить по источникам')})`;
   for(const source of d.sources){
    const sid=crypto.randomUUID();
    await tx`insert into app.entity_intake_sources(id,intake_id,url,title,description,publisher,author,published_at) values(${sid},${candidateId},${source.url},${source.title},${source.description},${source.publisher},${source.author},${source.published_at})`;
    for(const media of source.media)await tx`insert into app.entity_intake_media(id,source_id,url,media_entity_id,kind,caption,author,status,error) values(${crypto.randomUUID()},${sid},${media.url},${media.media_entity_id},${media.kind},${media.caption},${media.author},${media.status},${media.error})`;
   }
   d.sketch.related[index]={...r,candidate_intake_id:candidateId,entity_id:null,confirmed:false};
  }
  const original=await loadIntake(tx,d.id);
  await auditIntake(tx,original,actor.contributorId);
  await tx`update app.entity_intake set sketch=${JSON.stringify(d.sketch)}::jsonb,version=version+1 where id=${d.id}`;
  return await loadIntake(tx,d.id);
 }));
});
