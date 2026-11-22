import {matchCandidateConcept} from './matchCandidateConcept.ts';
import {sourceQuality} from './sourceEvidence.ts';
export const AXES={art_epochs:'Эпоха / парадигма',form_method:'Метод формообразования',art_styles:'Направление / школа',morphological_trait:'Морфологический признак'};
export const RELATIONS=['classification_membership','influence','classification_citation','classification_trait','classification_negation'];
export const normalized=(s:unknown)=>String(s||'').normalize('NFC').replace(/\s+/g,' ').trim();
export function resolveConcept(raw:any,catalog:any[]){
 return raw.concept_id==null?matchCandidateConcept(raw.candidate_name,raw.axis,catalog):catalog.find(c=>Number(c.id)===Number(raw.concept_id));
}
export function negationEvidence(raw:any,quote:string){
 if(raw.relation!=='classification_negation')return null;
 const e=raw.negation_evidence;
 const clause=normalized(e?.clause),subject=normalized(e?.object_words),predicate=normalized(e?.denial_words);
 if(e?.subject_kind!=='building_or_part'||!subject||!predicate||subject===predicate||!clause.includes(subject)||!clause.includes(predicate)||!quote.includes(clause)||/[.!?;]\s+\p{L}/u.test(clause)){
  throw new Error('Для отрицания нужна прямая фраза источника об объекте или его части. Принадлежность автора к группе и отсутствие упоминания недостаточны.');
 }
 return {subject_kind:'building_or_part',clause,object_words:subject,denial_words:predicate};
}
export function attributionProposal(raw:any,catalog:any[],sources:any[]){
 const aliases:Record<string,string>={membership:'classification_membership',trait:'classification_trait'};
 const requested=aliases[raw?.relation]||raw?.relation;
 if(!raw||!Object.hasOwn(AXES,raw.axis)||!RELATIONS.includes(requested))throw new Error('Неизвестная ось или отношение');
 const concept=resolveConcept(raw,catalog);
 if(raw.concept_id!=null&&!concept)throw new Error('Понятие не принадлежит указанной оси');
 if(!concept&&!normalized(raw.candidate_name))throw new Error('Укажите понятие или название кандидата');
 const candidates=sources.filter(s=>s.source_uid===raw.source_id||s.id===raw.source_id);
 const source=candidates.find(s=>normalized(s.source_text||s.text||s.source_excerpt||'').includes(normalized(raw.quote)))||candidates[0];
 if(!source)throw new Error('Источник отсутствует в переданном корпусе');
 const quote=normalized(raw.quote);const quality=sourceQuality(source);const full=quality==='page'?(source.source_text||source.text):'';
 const available=source.source_text||full||source.source_excerpt||source.text||'';
 if(quote.length<12||!normalized(available).includes(quote))throw new Error('Точная цитата не найдена в тексте источника');
 if(quote.length>400)throw new Error('Выберите цитату не длиннее 400 символов');
 if(!normalized(raw.rationale))throw new Error('Нет отдельного обоснования');
 const axis=concept?.axis||raw.axis;
 const positive=requested==='classification_membership'||requested==='classification_trait';
 const relation=positive?(['form_method','morphological_trait'].includes(axis)?'classification_trait':'classification_membership'):requested;
 if(axis==='art_epochs'&&positive&&/современная архитектура (?:xxi|21)(?:-го)? века/i.test(normalized(concept?.title_ru||raw.candidate_name)))throw Error('Календарный век не является архитектурной парадигмой');
 return {id:crypto.randomUUID(),kind:'attribution',negation_evidence:negationEvidence(raw,quote),axis,concept_id:concept?Number(concept.id):null,candidate_name:concept?'':normalized(raw.candidate_name).slice(0,200),title:concept?.title_ru||normalized(raw.candidate_name),relation,source_id:raw.source_id,quote,rationale:normalized(raw.rationale).slice(0,4000),phase:normalized(raw.phase).slice(0,500),zone:normalized(raw.zone).slice(0,500),locator:normalized(raw.locator).slice(0,500),evidence:quality,selected:false};
}
export function attributionFormat(catalog:any[],ids:string[],fragments?:number[]){
 const properties:any={axis:{type:'string',enum:Object.keys(AXES)},concept_id:{type:['integer','null'],enum:[...catalog.map(c=>Number(c.id)),null]},candidate_name:{type:'string'},relation:{type:'string',enum:RELATIONS},source_id:{type:'string',enum:ids},quote:{type:'string'},rationale:{type:'string',maxLength:200},phase:{type:'string'},zone:{type:'string'},locator:{type:'string'}};
 properties.negation_evidence={anyOf:[{type:'null'},{type:'object',additionalProperties:false,required:['subject_kind','clause','object_words','denial_words'],properties:{subject_kind:{type:'string',enum:['building_or_part','person_or_group','unclear']},clause:{type:'string'},object_words:{type:'string'},denial_words:{type:'string'}}}]};
 if(fragments){properties.quote={type:'string',minLength:12,maxLength:400};properties.fragment_id={type:'integer',enum:fragments};}
 return {type:'json_schema',json_schema:{name:'classification_attributions',strict:true,schema:{type:'object',properties:{proposals:{type:'array',maxItems:100,items:{type:'object',properties,required:Object.keys(properties),additionalProperties:false}}},required:['proposals'],additionalProperties:false}}};
}

export function attributionFromFragment(raw:any,fragments:any[]){
 const fragment=fragments.find(f=>f.fragment_id===raw.fragment_id);
 if(!fragment||fragment.id!==raw.source_id)throw Error('Фрагмент не принадлежит указанному источнику');
 const text=normalized(fragment.text),excerpt=normalized(raw.quote);
 const offset=text.indexOf(excerpt);
 if(excerpt.length<12||excerpt.length>400||offset<0)throw Error('Нужна дословная цитата из выбранного фрагмента длиной 12–400 символов');
 return {...raw,quote:text.slice(offset,offset+excerpt.length)};
}
