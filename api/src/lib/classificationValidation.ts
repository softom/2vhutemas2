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
 const quote=normalized(raw.quote);
 const literal=raw.quote_trimmed===true?quote.replace(/^…|…$/g,''):quote;
 const candidates=sources.filter(s=>s.source_uid===raw.source_id||s.id===raw.source_id);
 const source=candidates.find(s=>normalized(s.source_text||s.text||s.source_excerpt||'').includes(literal))||candidates[0];
 if(!source)throw new Error('Источник отсутствует в переданном корпусе');
 const quality=sourceQuality(source);const full=quality==='page'?(source.source_text||source.text):'';
 const available=source.source_text||full||source.source_excerpt||source.text||'';
 if(literal.length<12||!normalized(available).includes(literal))throw new Error('Точная цитата не найдена в тексте источника');
 if(quote.length>400)throw new Error('Выберите цитату не длиннее 400 символов');
 if(!normalized(raw.rationale))throw new Error('Нет отдельного обоснования');
 const axis=concept?.axis||raw.axis;
 const positive=requested==='classification_membership'||requested==='classification_trait';
 const relation=positive?(['form_method','morphological_trait'].includes(axis)?'classification_trait':'classification_membership'):requested;
 if(axis==='art_epochs'&&positive&&/современная архитектура (?:xxi|21)(?:-го)? века/i.test(normalized(concept?.title_ru||raw.candidate_name)))throw Error('Календарный век не является архитектурной парадигмой');
 return {id:crypto.randomUUID(),kind:'attribution',quote_trimmed:raw.quote_trimmed===true,negation_evidence:negationEvidence(raw,quote),axis,concept_id:concept?Number(concept.id):null,candidate_name:concept?'':normalized(raw.candidate_name).slice(0,200),title:concept?.title_ru||normalized(raw.candidate_name),relation,source_id:raw.source_id,quote,rationale:normalized(raw.rationale).slice(0,4000),phase:normalized(raw.phase).slice(0,500),zone:normalized(raw.zone).slice(0,500),locator:normalized(raw.locator).slice(0,500),evidence:quality,selected:false};
}
export function attributionFormat(catalog:any[],ids:string[],fragments?:number[]){
 const properties:any={axis:{type:'string',enum:Object.keys(AXES)},concept_id:{type:['integer','null'],enum:[...catalog.map(c=>Number(c.id)),null]},candidate_name:{type:'string'},relation:{type:'string',enum:RELATIONS},source_id:{type:'string',enum:ids},quote:{type:'string'},rationale:{type:'string',maxLength:200},phase:{type:'string'},zone:{type:'string'},locator:{type:'string'}};
 properties.negation_evidence={anyOf:[{type:'null'},{type:'object',additionalProperties:false,required:['subject_kind','clause','object_words','denial_words'],properties:{subject_kind:{type:'string',enum:['building_or_part','person_or_group','unclear']},clause:{type:'string'},object_words:{type:'string'},denial_words:{type:'string'}}}]};
 if(fragments){properties.quote={type:'string',minLength:12};properties.fragment_id={type:'integer',enum:fragments};}
 return {type:'json_schema',json_schema:{name:'classification_attributions',strict:true,schema:{type:'object',properties:{proposals:{type:'array',maxItems:100,items:{type:'object',properties,required:Object.keys(properties),additionalProperties:false}}},required:['proposals'],additionalProperties:false}}};
}

export function attributionFromFragment(raw:any,fragments:any[]){
 const fragment=fragments.find(f=>f.fragment_id===raw.fragment_id);
 if(!fragment||fragment.id!==raw.source_id)throw Error('Фрагмент не принадлежит указанному источнику');
 const requested=normalized(raw.quote);
 if(requested.length<12)throw Error('Слишком короткая цитата: требуется не менее 12 символов');
 // One-to-one substitutions preserve offsets in the normalized source text.
 const typography=(s:string)=>s.replace(/[“”«»„]/g,'"').replace(/[‘’]/g,"'").replace(/[‐‑–—]/g,'-');
 const needle=typography(requested);
 function locate(f:any){
  const text=normalized(f.text),exact=text.indexOf(requested);
  const at=exact>=0?exact:typography(text).indexOf(needle);
  return at<0?null:{fragment_id:f.fragment_id,excerpt:text.slice(at,at+requested.length)};
 }
 let match=locate(fragment);
 if(!match){
  const alternatives=fragments.filter(f=>f.id===raw.source_id&&f.fragment_id!==raw.fragment_id).map(locate).filter(m=>m!==null);
  if(alternatives.length!==1)throw Error(alternatives.length?'Цитата неоднозначна внутри источника':'Цитата не найдена в переданных фрагментах указанного источника');
  match=alternatives[0];
 }
 const {excerpt,fragment_id}=match;
 if(excerpt.length<=400)return {...raw,fragment_id,quote:excerpt,quote_trimmed:false};
 // Prefer a complete sentence; preserve the explicit denial when one is required.
 const clause=raw.relation==='classification_negation'?normalized(raw.negation_evidence?.clause):'';
 const sentences=Array.from(excerpt.matchAll(/[^.!?。！？]+[.!?。！？]+(?=\s|$)/gu),m=>m[0].trim());
 const sentence=sentences.filter(s=>s.length>=12&&s.length<=398&&s.includes(clause)).sort((a,b)=>b.length-a.length)[0];
 let literal=sentence||clause;
 if(!literal){
  const prefix=excerpt.slice(0,399);
  literal=prefix.replace(/\S+$/u,'').trimEnd();
 }
 if(literal.length<12||!excerpt.includes(literal))throw Error('Не удалось выделить короткую дословную выдержку');
 const quote=(excerpt.startsWith(literal)?'':'…')+literal+(excerpt.endsWith(literal)?'':'…');
 if(quote.length>400)throw Error('Прямая цитата отрицания превышает 400 символов');
 return {...raw,fragment_id,quote,quote_trimmed:true};
}
