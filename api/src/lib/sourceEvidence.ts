export function sourceQuality(source:any):'page'|'partial'|'snippet'{
 if(!source.source_text)return source.evidence==='partial'?'partial':source.evidence==='page'?'page':'snippet';
 try{const observations=JSON.parse(source.source_observations||'[]');const last=observations.filter((o:any)=>o.kind==='retrieval'&&o.chars).at(-1);if(last?.quality==='partial')return 'partial';}catch{/* legacy text has no retrieval metadata */}
 return 'page';
}
