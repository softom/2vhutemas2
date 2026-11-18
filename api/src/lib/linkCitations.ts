import {sql,type Query} from './db.ts';
import {ApiError} from './errors.ts';
import {extractText,validateDocument,saveRefs} from '../routes/documents.ts';

export function sourceMarks(body:unknown):{block:any;props:any}[]{
 const found:{block:any;props:any}[]=[];
 function inline(items:any,block:any){if(!Array.isArray(items))return;for(const item of items){if(item?.type==='sourceRef')found.push({block,props:item.props||{}});if(item?.content)inline(item.content,block);}}
 function walk(items:any){if(!Array.isArray(items))return;for(const b of items){inline(b?.content,b);walk(b?.children);}}
 walk(body);return found;
}

export async function validateLinkBody(db:Query,body:unknown,drafts:boolean){
 const blocks=validateDocument(body),marks=sourceMarks(blocks);
 if(!extractText(blocks).trim())throw new ApiError('link_requires_justification','Обоснование не может быть пустым');
 const ids=new Set<number>();
 const occurrences=new Set<string>();
 for(const {block,props} of marks){
  const id=Number(props.entityId);
  if(!Number.isSafeInteger(id)||id<=0)throw new ApiError('validation_failed','Некорректный ID источника');
  ids.add(id);
  if(block.type==='quote'&&!extractText([block]).trim())throw new ApiError('validation_failed','Цитата не может быть пустой');
  if(props.accessedAt&&(!/^\d{4}-\d{2}-\d{2}$/.test(props.accessedAt)||!Number.isFinite(Date.parse(props.accessedAt))||new Date(props.accessedAt).toISOString().slice(0,10)!==props.accessedAt))throw new ApiError('validation_failed','Дата получения: ГГГГ-ММ-ДД');
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if(!props.occurrenceId)props.occurrenceId=crypto.randomUUID();
  if(!uuid.test(props.occurrenceId))throw new ApiError('validation_failed','Некорректный идентификатор цитаты');
  if(occurrences.has(props.occurrenceId))throw new ApiError('validation_failed','Идентификаторы цитат должны различаться');
  occurrences.add(props.occurrenceId);
  if(props.sourceRevisionId&&!uuid.test(props.sourceRevisionId))throw new ApiError('validation_failed','Некорректная версия источника');
  if(props.sourceRevisionId){const rows=await db`select r.id from app.revisions r join app.entities e on e.id=r.entity_id where r.id=${props.sourceRevisionId} and e.id=${id} and (${drafts} or r.id=e.published_revision_id)`;if(!rows.length)throw new ApiError('validation_failed','Версия не принадлежит доступной редакции источника');}
 }
 if(ids.size>1)throw new ApiError('validation_failed','Для разных источников создайте отдельные связи');
 if(ids.size){const rows=await db<{id:number}>`select id from app.read_entities(${drafts}) where id=any(${[...ids]}::bigint[]) and (${drafts} or is_published)`;if(rows.length!==ids.size)throw new ApiError('validation_failed','Источник не найден или недоступен');}
 return blocks;
}

export type LinkCitation={source_entity_id:number;source_title:string;source_slug:string;quote:string;locator:string;accessed_at:string|null;source_revision_id:string|null};

/** One existing revision index for entity texts and link justifications. */
export async function indexLinkBody(db:Query,revision:string,body:unknown){
 await saveRefs(db,revision,body);
 for(const {props} of sourceMarks(body))if(props.sourceRevisionId)await db`update app.document_entity_refs set pinned_revision_id=${props.sourceRevisionId} where revision_id=${revision} and occurrence_id=${props.occurrenceId}`;
}

export async function presentLinkBodies(bodies:unknown[],drafts:boolean){
 const ids=[...new Set(bodies.flatMap(b=>sourceMarks(b).map(m=>Number(m.props.entityId))).filter(id=>Number.isSafeInteger(id)&&id>0))];
 const sources=ids.length?await sql<{id:number;title_ru:string;slug:string;published_revision_id:string|null}>`select id,title_ru,slug,published_revision_id from app.read_entities(${drafts}) where id=any(${ids}::bigint[]) and (${drafts} or is_published)`:[];
 const byId=new Map(sources.map(s=>[Number(s.id),s]));
 return bodies.map(body=>{
  const clean=(items:any):any[]=>Array.isArray(items)?items.map(b=>{
   const marks=sourceMarks([{...b,children:[]}]);
   if(marks.some(m=>!byId.has(Number(m.props.entityId))||!drafts&&m.props.sourceRevisionId&&byId.get(Number(m.props.entityId))?.published_revision_id!==m.props.sourceRevisionId))return {type:'paragraph',content:[{type:'text',text:'Источник цитаты недоступен'}]};
   return {...b,...(b.children?{children:clean(b.children)}:{})};
  }):[];
  const safe=clean(body);
  const citations=sourceMarks(safe).map(({block,props})=>{const s=byId.get(Number(props.entityId))!;return {source_entity_id:Number(s.id),source_title:s.title_ru,source_slug:s.slug,quote:block.type==='quote'?extractText([block]):'',locator:String(props.note||''),accessed_at:props.accessedAt||null,source_revision_id:props.sourceRevisionId||null};});
  return {body:safe,citations,justification:extractText(safe.filter(b=>!(b.type==='quote'&&sourceMarks([b]).length)))};
 });
}
