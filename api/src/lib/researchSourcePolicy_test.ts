import {isOwnResearchSource} from './researchSourcePolicy.ts';
Deno.test('Own research sources: domains, aliases, archive wrappers and boundaries',()=>{
 for(const url of ['https://2vhutemas.ru/entities/3121','http://WWW.2VHUTEMAS.RU./x','https://gis.2vhutemas.ru/x','http://155.212.170.40/x','https://r.jina.ai/https://2vhutemas.ru/x','https://web.archive.org/web/20261117/https://2vhutemas.ru/x']){
  if(!isOwnResearchSource(url))throw new Error('Not excluded: '+url);
 }
 for(const url of ['https://example.org/2vhutemas.ru','https://2vhutemas.ru.example.org/x','https://not2vhutemas.ru/x','https://example.org/?next=https://2vhutemas.ru','invalid']){
  if(isOwnResearchSource(url))throw new Error('Unrelated source excluded: '+url);
 }
 const old=Deno.env.get('SITE_URL');
 try{Deno.env.set('SITE_URL','https://our-alias.example');if(!isOwnResearchSource('https://www.our-alias.example/x'))throw new Error('Configured alias');}
 finally{if(old===undefined)Deno.env.delete('SITE_URL');else Deno.env.set('SITE_URL',old);}
});
