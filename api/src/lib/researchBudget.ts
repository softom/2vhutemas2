import {isExcludedResearchRow} from './researchSourcePolicy.ts';
import {sourceQuality} from './sourceEvidence.ts';
export const MAX_ANALYSIS_CALLS=2,MAX_ANALYSIS_CHARS=60000;
const topics=/brutalis|postmodern|tecnicis|modernis|art[ -]d[eé]co|стил|брутал|постмодер|конструк|тектони|suspend|structure|structural|hormig[oó]n|concrete|бетон|подвес|fachada|fa[cç]ade|corona|crown|стекл|glass|steel|acero|площад|area|superficie/ig;
const nameKey=(s:string)=>s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').split(' ').filter(w=>w&&!['de','del','la','el','los','las','the','of','and','и','в','на'].includes(w)).join(' ');
export function analysisPlan(sources:any[],set:any,names:string[]=[]){
 const external=sources.filter(s=>!isExcludedResearchRow(s));
 const usable=external.filter(s=>!!(s.source_text||s.source_excerpt));
 const keys=[...new Set(names.filter(Boolean).map(nameKey).filter(k=>k.length>=3))];
 const relevant=keys.length?usable.filter(s=>{const haystack=' '+nameKey([s.source_title,s.source_excerpt,s.source_text].filter(Boolean).join(' '))+' ';return keys.some(k=>haystack.includes(' '+k+' '));}):usable;
 const selected=relevant.slice(0,100),allowance=Math.floor(MAX_ANALYSIS_CHARS/Math.max(1,selected.length));
 const pieces:any[]=[];let inputChars=0,selectedChars=0;
 for(const s of usable)inputChars+=(s.source_text||s.source_excerpt||'').length;
 for(const s of selected){
  const text=String(s.source_text||s.source_excerpt||'');
  // Original substrings, never an LLM summary. Keep surrounding context and wording.
  const spans:any[]=[];const re=/[^.!?\n]+[.!?]?(?:\s+|$)/g;let m:RegExpExecArray|null;
  while((m=re.exec(text))){for(let i=0;i<m[0].length;i+=900){const part=m[0].slice(i,i+900);const score=(part.match(topics)||[]).length;spans.push({start:m.index+i,text:part,score});}}
  if(!spans.length&&text)spans.push({start:0,text:text.slice(0,900),score:0});
  const ranked=set.code==='style_solutions'?spans.sort((a,b)=>b.score-a.score||a.start-b.start):spans;
  let used=0;const chosen=[];const seen=new Set<string>();for(const span of ranked){const key=span.text.replace(/\s+/g," ").trim();if(seen.has(key))continue;seen.add(key);if(used>=allowance)break;const part=span.text.slice(0,allowance-used);if(!part.trim())continue;chosen.push({...span,text:part});used+=part.length;}
  chosen.sort((a,b)=>a.start-b.start);
  const merged:any[]=[];for(const span of chosen){const last=merged.at(-1);if(last&&last.start+last.text.length===span.start&&last.text.length+span.text.length<=1600)last.text+=span.text;else merged.push({...span});}
  for(const span of merged){pieces.push({id:s.source_uid,url:s.source_url,title:s.source_title,source_number:sources.indexOf(s)+1,offset:span.start,text:span.text,evidence:sourceQuality(s)});selectedChars+=span.text.length;}
 }
 const chunks:any[][]=[];let batch:any[]=[],size=0;
 for(const p of pieces){let offset=0;while(offset<p.text.length){const n=Math.min(30000-size,p.text.length-offset);batch.push({...p,offset:p.offset+offset,text:p.text.slice(offset,offset+n)});size+=n;offset+=n;if(size===30000){chunks.push(batch);batch=[];size=0;}}}if(batch.length)chunks.push(batch);
 let fragment=0;for(const chunk of chunks)for(const piece of chunk)piece.fragment_id=++fragment;
 if(chunks.length>MAX_ANALYSIS_CALLS)throw Error('Превышен бюджет анализа');
 return {chunks,summary:{calls:chunks.length,max_calls:MAX_ANALYSIS_CALLS,input_chars:inputChars,selected_chars:selectedChars,total_sources:external.length,excluded_unrelated:usable.length-relevant.length,analyzed_sources:selected.length,limited:selectedChars<inputChars,method:'Локальный отбор фрагментов; полные тексты остаются сохранёнными'}};
}
