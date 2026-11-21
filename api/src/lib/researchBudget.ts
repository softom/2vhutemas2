import {isExcludedResearchRow} from './researchSourcePolicy.ts';
import {sourceQuality} from './sourceEvidence.ts';
export const MAX_ANALYSIS_CALLS=2,MAX_ANALYSIS_CHARS=60000;
const nameKey=(s:string)=>s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').split(' ').filter(w=>w&&!['de','del','la','el','los','las','the','of','and','и','в','на'].includes(w)).join(' ');
export function analysisPlan(sources:any[],set:any,names:string[]=[]){
 const maxChars=Math.min(MAX_ANALYSIS_CHARS,set.task?.max_source_chars||MAX_ANALYSIS_CHARS),maxCalls=Math.min(MAX_ANALYSIS_CALLS,set.task?.max_calls||MAX_ANALYSIS_CALLS);
 const terms=[...new Set<string>((set.search_profiles||[]).flatMap((p:any)=>p.topic_terms||[]))].map(s=>s.toLocaleLowerCase());
 const external=sources.filter(s=>!isExcludedResearchRow(s));
 const usable=external.filter(s=>!!(s.source_text||s.source_excerpt));
 const keys=[...new Set(names.filter(Boolean).map(nameKey).filter(k=>k.length>=3))];
 const relevant=keys.length?usable.filter(s=>{const haystack=' '+nameKey([s.source_title,s.source_excerpt,s.source_text].filter(Boolean).join(' '))+' ';return keys.some(k=>haystack.includes(' '+k+' '));}):usable;
 const limit=Math.min(maxChars,maxCalls*30000);
 const inputChars=usable.reduce((sum,s)=>sum+String(s.source_text||s.source_excerpt).length,0);
 const ranked:{source:any;source_number:number;start:number;text:string;score:number}[]=[];
 for(const s of relevant){
  const original=String(s.source_text||s.source_excerpt);
  const seen=new Set<string>();
  for(const match of original.matchAll(/[^.!?\n]+[.!?]*\s*/g)){
   for(let i=0;i<match[0].length;i+=900){
    const text=match[0].slice(i,i+900),key=text.trim().toLowerCase();
    if(!key||seen.has(key))continue;
    seen.add(key);
    const score=terms.filter(term=>key.includes(term)).length;
    ranked.push({source:s,source_number:sources.indexOf(s)+1,start:match.index+i,text,score});
   }
  }
 }
 ranked.sort((a,b)=>b.score-a.score||Number(!!b.source.source_text)-Number(!!a.source.source_text)||a.start-b.start||a.source_number-b.source_number);
 const pieces:any[]=[],used=new Map<number,number>();let selectedChars=0;
 for(const span of ranked){
  if(selectedChars>=limit)break;
  const previous=used.get(span.source_number)||0;
  const text=span.text.slice(0,Math.min(4000-previous,limit-selectedChars));
  if(!text.trim())continue;
  const s=span.source;
  pieces.push({id:s.source_uid,url:s.source_url,title:s.source_title,source_number:span.source_number,offset:span.start,text,evidence:sourceQuality(s)});
  used.set(span.source_number,previous+text.length);selectedChars+=text.length;
 }
 pieces.sort((a,b)=>a.source_number-b.source_number||a.offset-b.offset);
 const chunks:any[][]=[];let batch:any[]=[],size=0;
 for(const p of pieces){let offset=0;while(offset<p.text.length){const n=Math.min(30000-size,p.text.length-offset);batch.push({...p,offset:p.offset+offset,text:p.text.slice(offset,offset+n)});size+=n;offset+=n;if(size===30000){chunks.push(batch);batch=[];size=0;}}}if(batch.length)chunks.push(batch);
 let fragment=0;for(const chunk of chunks)for(const piece of chunk)piece.fragment_id=++fragment;
 if(chunks.length>MAX_ANALYSIS_CALLS)throw Error('Превышен бюджет анализа');
 return {chunks,summary:{calls:chunks.length,max_calls:maxCalls,input_chars:inputChars,selected_chars:selectedChars,total_sources:external.length,excluded_unrelated:usable.length-relevant.length,analyzed_sources:used.size,limited:selectedChars<inputChars,method:'Локальный отбор фрагментов; полные тексты остаются сохранёнными'}};
}
