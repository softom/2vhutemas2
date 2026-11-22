import {presets,type Depth} from './researchBudget.ts';
export type SearchIdentity={architect?:string;city?:string;title_ru:string;title_en?:string|null;title_original?:string|null;original_language?:string|null};
export type SearchQuery={title:string;query:string;language:string;searchType:'SEARCH_TYPE_RU'|'SEARCH_TYPE_COM'};
export function researchQueries(identity:SearchIdentity,set:{title_ru:string;code?:string;search_profiles?:any[]},depth:Depth="medium"):SearchQuery[]{
 const original=String(identity.original_language||'').trim().toLowerCase().split('-')[0];
 const lang=({испанский:'es',английский:'en',французский:'fr',немецкий:'de',итальянский:'it'} as Record<string,string>)[original]||original||'und';
 const profiles=set.search_profiles||[],seen=new Set<string>(),out:SearchQuery[]=[];
 const names=[{title:identity.title_ru,lang:'ru',source:'title_ru'},{title:identity.title_en||identity.title_original||identity.title_ru,lang:'en',source:'title_en'},...(identity.title_original?[{title:identity.title_original,lang,source:'title_original'}]:[])];
 for(const name of names){
  if(!name.title?.trim()||(name.lang==='en'&&/[А-Яа-яЁё]/.test(name.title)))continue;
  let rules=profiles.filter(p=>p.enabled&&p.language_tag===name.lang);
  if(!rules.length)rules=profiles.filter(p=>p.enabled&&p.language_tag==='und');
  for(const rule of rules){
   const title=rule.title_source==='title_ru'?identity.title_ru:rule.title_source==='title_en'?(identity.title_en||identity.title_original||identity.title_ru):(identity.title_original||name.title);
   const query=String(rule.query_template).replaceAll('{title}',title.trim()).replaceAll('{set_title}',set.title_ru).trim();
   if(!query||(name.lang==='en'&&/[А-Яа-яЁё]/.test(title))||seen.has(query))continue;seen.add(query);
   out.push({title:title.trim(),query,language:name.lang,searchType:name.lang==='ru'?'SEARCH_TYPE_RU':'SEARCH_TYPE_COM'});
  }
 }
 if((set as {code?:string}).code!=='style_solutions')return out.slice(0,6);
 const title=identity.title_ru;
 const prioritized:SearchQuery[]=[];
 function add(query:string,language='ru',name=title){
  prioritized.push({title:name,query,language,searchType:language==='ru'?'SEARCH_TYPE_RU':'SEARCH_TYPE_COM'});
 }
 add(title+' архитектурный стиль композиция фасад');
 if(identity.architect||identity.city)add([title,identity.architect,identity.city,'архитектура'].filter(Boolean).join(' '));
 if(depth==='max'){
  for(const suffix of ['стиль критика полемика атрибуция','перестройка реконструкция этапы','конструкции несущая система материал'])add(title+' '+suffix);
  if(identity.title_en&&!/[А-Яа-яЁё]/.test(identity.title_en))add(identity.title_en+' architectural criticism reconstruction structure','en',identity.title_en);
 }
 for(const language of new Set(out.map(q=>q.language)))prioritized.push(out.find(q=>q.language===language)!);
 const unique=new Map<string,SearchQuery>();
 for(const q of [...prioritized,...out])if(!unique.has(q.query))unique.set(q.query,q);
 return [...unique.values()].slice(0,presets[depth].queries);
}
