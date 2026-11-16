import {parseResearch,selectResearch,researchParagraphs,researchUrl,researchRunning} from './intakeResearchSchema.ts';
const assert=(v:unknown)=>{if(!v)throw new Error('assertion failed');};
const reject=(fn:()=>unknown)=>{let failed=false;try{fn();}catch{failed=true;}assert(failed);};
const sources=[{id:'source-uid',url:'https://example.org/evidence',title:'Evidence',excerpt:'Evidence text',provider:'fixture',evidence:'snippet' as const}];
const raw=()=>({summary:'Фазы различаются',consensus:'split',phases:[{period:'1976',description:'Оригинал',zones:['body']}],findings:[{kind:'style',title:'Брутализм',relation:'negative',level:'стиль',phase:'1976',zone:'body',rationale:'Источник отрицает атрибуцию',source_ids:['source-uid'],entity_id:null}]});
Deno.test('research requires evidence, valid UID and structured fields',()=>{
 const result=parseResearch(raw(),sources,[],'job','model',[]);assert(!result.findings[0].selected);
 reject(()=>parseResearch({...raw(),consensus:'<img onerror=x>'},sources,[],'job','model',[]));
 reject(()=>parseResearch({...raw(),findings:[{...raw().findings[0],source_ids:['invented']}]},sources,[],'job','model',[]));
 reject(()=>parseResearch({...raw(),findings:[{...raw().findings[0],entity_id:123}]},sources,[],'job','model',[]));
 reject(()=>researchUrl('javascript:alert(1)'));reject(()=>researchUrl('https://user:pass@example.org'));
});
Deno.test('selection is by proposal UID, preserves evidence and publishes negation with phase',()=>{
 const r=parseResearch(raw(),sources,[],'job','model',[]);
 reject(()=>selectResearch(r,['invented']));reject(()=>selectResearch(r,[r.findings[0].id,r.findings[0].id]));
 assert(researchParagraphs(r).length===0);
 const selected=selectResearch(r,[r.findings[0].id]);assert(selected.sources===r.sources);
 const body=JSON.stringify(researchParagraphs(selected));assert(body.includes('Отрицание атрибуции'));assert(body.includes('1976'));assert(body.includes('полный текст не проверен'));assert(body.includes(sources[0].url));
 assert(!r.findings[0].selected);
 assert(researchParagraphs({...selected,state:'error'}).length===0);
});
Deno.test('job expiration permits retry without resetting prepared prose',()=>{
 assert(researchRunning({state:'running',started_at:new Date().toISOString()}));
 assert(!researchRunning({state:'running',started_at:new Date(Date.now()-301000).toISOString()}));
 assert(!researchRunning({state:'running',started_at:'invalid'}));
});
