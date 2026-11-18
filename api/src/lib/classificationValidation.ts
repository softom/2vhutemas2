import {sourceQuality} from './sourceEvidence.ts';
export const AXES={art_epochs:'Эпоха / парадигма',form_method:'Метод формообразования',art_styles:'Направление / школа',morphological_trait:'Морфологический признак'};
export const RELATIONS=['classification_membership','influence','classification_citation','classification_trait','classification_negation'];
export const normalized=(s:unknown)=>String(s||'').normalize('NFC').replace(/\s+/g,' ').trim();
export function attributionProposal(raw:any,catalog:any[],sources:any[]){
 if(!raw||!Object.hasOwn(AXES,raw.axis)||!RELATIONS.includes(raw.relation))throw new Error('Неизвестная ось или отношение');
 const concept=raw.concept_id==null?null:catalog.find(c=>Number(c.id)===Number(raw.concept_id)&&c.axis===raw.axis);
 if(raw.concept_id!=null&&!concept)throw new Error('Понятие не принадлежит указанной оси');
 if(!concept&&!normalized(raw.candidate_name))throw new Error('Укажите понятие или название кандидата');
 const candidates=sources.filter(s=>s.source_uid===raw.source_id||s.id===raw.source_id);
 const source=candidates.find(s=>normalized(s.source_text||s.text||s.source_excerpt||'').includes(normalized(raw.quote)))||candidates[0];
 if(!source)throw new Error('Источник отсутствует в переданном корпусе');
 const quote=normalized(raw.quote);const quality=sourceQuality(source);const full=quality==='page'?(source.source_text||source.text):'';
 const available=source.source_text||full||source.source_excerpt||source.text||'';
 if(quote.length<12||quote.length>6000||!normalized(available).includes(quote))throw new Error('Точная цитата не найдена в тексте источника');
 if(!normalized(raw.rationale))throw new Error('Нет отдельного обоснования');
 return {id:crypto.randomUUID(),kind:'attribution',axis:raw.axis,concept_id:concept?Number(concept.id):null,candidate_name:concept?'':normalized(raw.candidate_name).slice(0,200),title:concept?.title_ru||normalized(raw.candidate_name),relation:raw.relation,source_id:raw.source_id,quote,rationale:normalized(raw.rationale).slice(0,4000),phase:normalized(raw.phase).slice(0,500),zone:normalized(raw.zone).slice(0,500),locator:normalized(raw.locator).slice(0,500),evidence:quality,selected:false};
}
export function attributionFormat(catalog:any[],ids:string[],fragments?:number[]){
 const properties:any={axis:{type:'string',enum:Object.keys(AXES)},concept_id:{type:['integer','null'],enum:[...catalog.map(c=>Number(c.id)),null]},candidate_name:{type:'string'},relation:{type:'string',enum:RELATIONS},source_id:{type:'string',enum:ids},quote:{type:'string'},rationale:{type:'string'},phase:{type:'string'},zone:{type:'string'},locator:{type:'string'}};
 if(fragments){delete properties.quote;properties.fragment_id={type:'integer',enum:fragments};}
 return {type:'json_schema',json_schema:{name:'classification_attributions',strict:true,schema:{type:'object',properties:{proposals:{type:'array',maxItems:100,items:{type:'object',properties,required:Object.keys(properties),additionalProperties:false}}},required:['proposals'],additionalProperties:false}}};
}

export function attributionFromFragment(raw:any,fragments:any[]){
 const fragment=fragments.find(f=>f.fragment_id===raw.fragment_id);
 if(!fragment||fragment.id!==raw.source_id)throw Error('Фрагмент не принадлежит указанному источнику');
 return {...raw,quote:fragment.text};
}
