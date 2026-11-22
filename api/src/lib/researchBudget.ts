import {isExcludedResearchRow} from './researchSourcePolicy.ts';
import {sourceQuality} from './sourceEvidence.ts';
export const presets={
 min:{queries:4,source:2500,calls:2,chars:80000},
 medium:{queries:8,source:6000,calls:5,chars:200000},
 max:{queries:12,source:15000,calls:12,chars:450000},
};
export type Depth=keyof typeof presets;
const nameKey=(s:string)=>s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').split(' ').filter(w=>w&&!['de','del','la','el','los','las','the','of','and','и','в','на'].includes(w)).join(' ');
export function analysisPlan(sources:any[],set:any,names:string[]=[],depth:Depth="medium"){
 const style=set.code==='style_solutions';
 const preset=presets[depth];
 const maxChars=style?preset.chars:Math.min(200000,set.task?.max_source_chars||60000);
 const maxCalls=style?preset.calls:Math.min(5,set.task?.max_calls||2);
 const terms=[...new Set<string>((set.search_profiles||[]).flatMap((p:any)=>p.topic_terms||[]))].map(s=>s.toLocaleLowerCase());
 const external=sources.filter(s=>!isExcludedResearchRow(s));
 const usable=external.filter(s=>!!(s.source_text||s.source_excerpt));
 const keys=[...new Set(names.filter(Boolean).map(nameKey).filter(k=>k.length>=3))];
 const relevant=keys.length?usable.filter(s=>{const haystack=' '+nameKey([s.source_title,s.source_excerpt,s.source_text].filter(Boolean).join(' '))+' ';return keys.some(k=>/\p{Script=Han}/u.test(k)?haystack.includes(k):haystack.includes(' '+k+' '));}):usable;
 const chunkSize=set.code==='style_solutions'?40000:30000;
 const limit=Math.min(maxChars,maxCalls*chunkSize);
 const inputChars=relevant.reduce((sum,s)=>sum+String(s.source_text||s.source_excerpt).length,0);
 const ranked:{source_number:number;start:number;end:number;score:number}[]=[];
 let longArticle=false;
 for(const s of relevant){
  const original=String(s.source_text||s.source_excerpt);
  const parts=Array.from(original.matchAll(/[^.!?\n]+[.!?]*\s*/g));
  const source_number=sources.indexOf(s)+1;
  for(let i=0;i<parts.length;){
   let last=i;
   while(last+1<parts.length&&!parts[last][0].includes('\n'))last++;
   let paragraphScore=-1;
   for(let j=i;j<=last;j++){
    const key=parts[j][0].toLowerCase(), score=terms.filter(term=>key.includes(term)).length;
    if(style&&depth==='min'&&terms.length&&!score)continue;
    if(score&&s.source_text&&original.length>6000)longArticle=true;
    const left=style&&depth==='max'?Math.max(0,i-1):style&&depth==='medium'&&j===parts.length-1?Math.max(0,j-1):j;
    const right=style&&depth==='max'?Math.min(parts.length-1,last+1):style&&depth==='medium'?Math.min(parts.length-1,j+1):j;
    if(style&&depth==='max'){
     paragraphScore=Math.max(paragraphScore,score);
     if(j<last)continue;
    }
    ranked.push({source_number,start:parts[left].index!,end:parts[right].index!+parts[right][0].length,score:paragraphScore>=0?paragraphScore:score});
   }
   i=last+1;
  }
 }
 ranked.sort((a,b)=>b.score-a.score||a.start-b.start||a.source_number-b.source_number);
 const pieces:any[]=[],used=new Map<number,number>();
 const covered=new Map<number,Uint8Array>();let selectedChars=0;
 for(const span of ranked){
  if(selectedChars>=limit)break;
  const n=span.source_number,s=sources[n-1],original=String(s.source_text||s.source_excerpt);
  let remaining=Math.min((style?preset.source:4000)-(used.get(n)||0),limit-selectedChars);
  if(!remaining)continue;
  let mask=covered.get(n);if(!mask){mask=new Uint8Array(original.length);covered.set(n,mask);}
  for(let pos=span.start;pos<span.end&&remaining;){
   if(mask[pos]){pos++;continue;}
   const start=pos;
   while(pos<span.end&&!mask[pos]&&pos-start<remaining&&pos-start<6000)pos++;
   const text=original.slice(start,pos);
   mask.fill(1,start,pos);
   if(!text.trim())continue;
   pieces.push({id:s.source_uid,url:s.source_url,title:s.source_title,source_number:n,offset:start,text,evidence:sourceQuality(s)});
   remaining-=text.length;selectedChars+=text.length;used.set(n,(used.get(n)||0)+text.length);
  }
 }
 pieces.sort((a,b)=>a.source_number-b.source_number||a.offset-b.offset);
 const chunks:any[][]=[];let batch:any[]=[],size=0;
 for(const p of pieces){let offset=0;while(offset<p.text.length){const n=Math.min(chunkSize-size,p.text.length-offset);batch.push({...p,offset:p.offset+offset,text:p.text.slice(offset,offset+n)});size+=n;offset+=n;if(size===chunkSize){chunks.push(batch);batch=[];size=0;}}}if(batch.length)chunks.push(batch);
 let fragment=0;for(const chunk of chunks)for(const piece of chunk)piece.fragment_id=++fragment;
 if(chunks.length>maxCalls)throw Error('Превышен бюджет анализа');
 return {chunks,summary:{calls:chunks.length,max_calls:maxCalls,input_chars:inputChars,selected_chars:selectedChars,depth,estimated_calls:chunks.length,coverage_pct:inputChars?Math.round(1000*selectedChars/inputChars)/10:0,long_article:longArticle,total_sources:sources.length,relevant_sources:relevant.length,excluded_unrelated:usable.length-relevant.length,analyzed_sources:used.size,limited:selectedChars<inputChars,method:'Локальный отбор фрагментов; полные тексты остаются сохранёнными'}};
}

export function preflight(sources:any[],set:any,names:string[]){
 const plan=(depth:Depth)=>analysisPlan(sources,set,names,depth).summary;
 const medium=plan('medium');
 if(set.code!=='style_solutions')return medium;
 const modes={min:plan('min'),medium,max:plan('max')};
 const low=medium.relevant_sources<10||medium.input_chars<30000;
 const deep=medium.long_article||medium.selected_chars<0.4*medium.input_chars||medium.input_chars>600000;
 const recommended_mode=deep?'max':medium.input_chars<150000?'min':'medium';
 return {...medium,modes,low_coverage_warning:low,recommended_mode,reason:low?'Мало релевантных источников или текста. Сначала доищите источники.':medium.long_article?'Есть длинные статьи с тематическими совпадениями.':deep?'Большой корпус или охват среднего режима ниже 40%.':'По объёму релевантного текста.'};
}
