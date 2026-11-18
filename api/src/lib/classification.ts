import {sql,type Tx} from './db.ts';
export const AXES={art_epochs:'Эпоха / парадигма',form_method:'Метод формообразования',art_styles:'Направление / школа',morphological_trait:'Морфологический признак'};
export const RELATIONS=['classification_membership','influence','classification_citation','classification_trait','classification_negation'];
export async function classificationCatalog(tx:Tx=sql,drafts=true){
 const rows=await tx<any>`select e.id,e.title_ru,e.title_en,e.title_original,e.original_language,e.slug,e.is_published,t.code as axis,
 coalesce((select v.text_value from app.read_indicators(${drafts}) i join app.read_values(${drafts}) v on v.indicator_id=i.id join app.parameters p on p.id=v.parameter_id where i.entity_id=e.id and p.code='concept_definition' order by i.sort_order limit 1),'') as definition,
 coalesce((select app.table_rows_json(p.id,v.table_value) from app.read_indicators(${drafts}) i join app.read_values(${drafts}) v on v.indicator_id=i.id join app.parameters p on p.id=v.parameter_id where i.entity_id=e.id and p.code='concept_names' order by i.sort_order limit 1),'[]'::jsonb) as names
 from app.read_entities(${drafts}) e join app.entity_types t on t.id=e.type_id where t.code=any(${Object.keys(AXES)}::text[]) and (${drafts} or e.is_published) order by t.sort_order,e.id`;
 return rows.map(r=>({...r,id:Number(r.id)}));
}
export const normalized=(s:unknown)=>String(s||'').normalize('NFC').replace(/\s+/g,' ').trim();
export function attributionProposal(raw:any,catalog:any[],sources:any[]){
 if(!raw||!Object.hasOwn(AXES,raw.axis)||!RELATIONS.includes(raw.relation))throw new Error('Неизвестная ось или отношение');
 const concept=raw.concept_id==null?null:catalog.find(c=>Number(c.id)===Number(raw.concept_id)&&c.axis===raw.axis);
 if(raw.concept_id!=null&&!concept)throw new Error('Понятие не принадлежит указанной оси');
 if(!concept&&!normalized(raw.candidate_name))throw new Error('Укажите понятие или название кандидата');
 const source=sources.find(s=>s.source_uid===raw.source_id||s.id===raw.source_id);
 if(!source)throw new Error('Источник отсутствует в переданном корпусе');
 const quote=normalized(raw.quote);const full=source.source_text??(source.evidence==='page'?source.text:'');
 const available=full||source.source_excerpt||source.text||'';
 if(quote.length<12||quote.length>6000||!normalized(available).includes(quote))throw new Error('Точная цитата не найдена в тексте источника');
 if(!normalized(raw.rationale))throw new Error('Нет отдельного обоснования');
 return {id:crypto.randomUUID(),kind:'attribution',axis:raw.axis,concept_id:concept?Number(concept.id):null,candidate_name:concept?'':normalized(raw.candidate_name).slice(0,200),title:concept?.title_ru||normalized(raw.candidate_name),relation:raw.relation,source_id:raw.source_id,quote,rationale:normalized(raw.rationale).slice(0,4000),phase:normalized(raw.phase).slice(0,500),zone:normalized(raw.zone).slice(0,500),locator:normalized(raw.locator).slice(0,500),evidence:full?'page':'snippet',selected:false};
}
export function attributionFormat(catalog:any[],ids:string[]){
 const properties={axis:{type:'string',enum:Object.keys(AXES)},concept_id:{type:['integer','null'],enum:[...catalog.map(c=>Number(c.id)),null]},candidate_name:{type:'string'},relation:{type:'string',enum:RELATIONS},source_id:{type:'string',enum:ids},quote:{type:'string'},rationale:{type:'string'},phase:{type:'string'},zone:{type:'string'},locator:{type:'string'}};
 return {type:'json_schema',json_schema:{name:'classification_attributions',strict:true,schema:{type:'object',properties:{proposals:{type:'array',maxItems:100,items:{type:'object',properties,required:Object.keys(properties),additionalProperties:false}}},required:['proposals'],additionalProperties:false}}};
}
