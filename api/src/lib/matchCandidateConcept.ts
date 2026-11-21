// Match across axes. The model's axis is only a display hint.
const clean=(s:unknown)=>String(s??'').normalize('NFKC').toLowerCase().replace(/ё/g,'е').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
function stems(s:string){
 return clean(s).split(' ').filter(w=>w&&!['и','или','как','из','в','на','с','к','для','по'].includes(w)&&! /^(архитектурн|прозрачн|здани)/.test(w)).map(w=>{
  if(w.length<5||!/[а-я]/.test(w))return w;
  const root=w.replace(/(иями|ями|ами|ого|его|ому|ему|ыми|ими|ией|иям|иях|ую|юю|ая|яя|ое|ее|ой|ый|ий|ых|их|ые|ие|ом|ем|ам|ям|ах|ях|ия|ие|ий|ы|и|а|я|у|ю|е|о)$/,'');
  return root.length>=3?root:w;
 });
}
export function matchCandidateConcept(candidateName:unknown,_axis:unknown,catalog:any[]){
 const key=clean(candidateName);if(!key)return undefined;
 const entries=catalog.map(c=>({c,names:[c.title_ru,c.title_en,c.title_original,...(c.names||[]).map((n:any)=>typeof n==='string'?n:n.concept_name_text)].filter(Boolean)}));
 const exact=entries.filter(e=>e.names.some(n=>clean(n)===key));
 if(exact.length)return exact.length===1?exact[0].c:undefined;
 const tokens=stems(key);if(!tokens.length)return undefined;
 const hits=entries.filter(e=>e.names.some(n=>{const words=new Set(stems(n));return tokens.every(t=>words.has(t));}));
 return hits.length===1?hits[0].c:undefined;
}
