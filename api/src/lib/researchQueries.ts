export type SearchIdentity={title_ru:string;title_en?:string|null;title_original?:string|null;original_language?:string|null};
export type SearchQuery={title:string;query:string;language:string;searchType:'SEARCH_TYPE_RU'|'SEARCH_TYPE_COM'};
const terms:Record<string,string[]>={ru:['архитектурный стиль','конструкция история'],en:['architectural style','structure history'],es:['estilo arquitectónico','estructura historia'],de:['Architekturstil','Konstruktion Geschichte'],fr:['style architectural','structure histoire'],it:['stile architettonico','struttura storia'],pt:['estilo arquitetônico','estrutura história'],tr:['mimari üslup','yapı tarihi']};
export function researchQueries(identity:SearchIdentity,set:{code:string;title_ru:string}):SearchQuery[]{
 const original=String(identity.original_language||'').trim().toLowerCase().split('-')[0];
 const lang=({испанский:'es',английский:'en',французский:'fr',немецкий:'de',итальянский:'it'} as Record<string,string>)[original]||original||'und';
 const names=[{title:identity.title_ru,lang:'ru'},{title:identity.title_en||identity.title_original||identity.title_ru,lang:'en'},...(identity.title_original?[{title:identity.title_original,lang}]:[])];
 const seen=new Set<string>();const out:SearchQuery[]=[];
 for(const name of names){
  if(!name.title?.trim())continue;
  const themes=set.code==='style_solutions'?(terms[name.lang]||['','architecture']):/tep|technical/.test(set.code)||/экономич/.test(set.title_ru)?(name.lang==='ru'?['площадь высота этажность','технические характеристики']:['floor area height floors','building dimensions']):[name.lang==='ru'?set.title_ru:'',name.lang==='ru'?'описание':'description'];
  for(const theme of themes){const query=(name.title.trim()+' '+theme).trim();if(seen.has(query))continue;seen.add(query);out.push({title:name.title.trim(),query,language:name.lang,searchType:name.lang==='ru'?'SEARCH_TYPE_RU':'SEARCH_TYPE_COM'});}
 }
 return out.slice(0,6);
}
