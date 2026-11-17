import {isOwnResearchSource} from './researchSourcePolicy.ts';
import type { Tx } from './db.ts';
import { researchUrl } from './intakeResearchSchema.ts';
import {researchData,saveResearch} from './setResearch.ts';
// Legacy dossier collection writes the same canonical corpus as set research.
export async function storeExternalDescriptions(tx:Tx,entityId:number,intakeId:string,research:any,createVersion=true){
 if(!entityId||research?.state==='stale'||!Array.isArray(research?.sources))return;
 await tx`select id from app.entities where id=${entityId} for update`;
 const data=await researchData(tx,entityId);
 for(const s of research.sources){
  let address:string;
  try{const u=new URL(researchUrl(s.url));if(isOwnResearchSource(u.href))continue;u.hash='';address=u.href.replace(/\/$/,'');}catch{continue;}
  let row=data.sources.find((r:any)=>r.source_url===address);
  if(!row){row={source_uid:crypto.randomUUID(),source_url:address,source_title:String(s.title||''),source_excerpt:String(s.excerpt||''),source_provider:String(s.provider||''),source_sets:'[]',source_queries:'[]',source_text:'',source_status:'Поисковая выдержка',source_fetched:new Date().toISOString(),source_observations:'[]'};data.sources.push(row);}
  const observations=JSON.parse(row.source_observations||'[]');
  const key=intakeId+':'+String(research.job||'legacy')+':'+s.id;
  if(!observations.some((o:any)=>o.id===key))observations.push({id:key,intake_id:intakeId,title:s.title,excerpt:s.excerpt,provider:s.provider,at:new Date().toISOString()});
  row.source_observations=JSON.stringify(observations);
  row.source_excerpt=String(s.excerpt||row.source_excerpt);row.source_title=String(s.title||row.source_title);
 }
 const [actor]=await tx<{id:string}>`select nullif(current_setting('app.contributor_id',true),'') as id`;
 return await saveResearch(tx,entityId,actor.id,data,createVersion);
}
