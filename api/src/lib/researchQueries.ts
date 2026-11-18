export type SearchIdentity={title_ru:string;title_en?:string|null;title_original?:string|null;original_language?:string|null};
export type SearchQuery={title:string;query:string;language:string;searchType:'SEARCH_TYPE_RU'|'SEARCH_TYPE_COM'};
export function researchQueries(identity:SearchIdentity,set:{title_ru:string;search_profiles?:any[]}):SearchQuery[]{
 const original=String(identity.original_language||'').trim().toLowerCase().split('-')[0];
 const lang=({испанский:'es',английский:'en',французский:'fr',немецкий:'de',итальянский:'it'} as Record<string,string>)[original]||original||'und';
 const profiles=set.search_profiles||[],seen=new Set<string>(),out:SearchQuery[]=[];
 const names=[{title:identity.title_ru,lang:'ru',source:'title_ru'},{title:identity.title_en||identity.title_original||identity.title_ru,lang:'en',source:'title_en'},...(identity.title_original?[{title:identity.title_original,lang,source:'title_original'}]:[])];
 for(const name of names){
  if(!name.title?.trim())continue;
  let rules=profiles.filter(p=>p.enabled&&p.language_tag===name.lang);
  if(!rules.length)rules=profiles.filter(p=>p.enabled&&p.language_tag==='und');
  for(const rule of rules){
   const title=rule.title_source==='title_ru'?identity.title_ru:rule.title_source==='title_en'?(identity.title_en||identity.title_original||identity.title_ru):(identity.title_original||name.title);
   const query=String(rule.query_template).replaceAll('{title}',title.trim()).replaceAll('{set_title}',set.title_ru).trim();
   if(!query||seen.has(query))continue;seen.add(query);
   out.push({title:title.trim(),query,language:name.lang,searchType:name.lang==='ru'?'SEARCH_TYPE_RU':'SEARCH_TYPE_COM'});
  }
 }
 return out.slice(0,6);
}
