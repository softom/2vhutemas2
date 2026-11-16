import type { Tx } from './db.ts';
import { researchUrl } from './intakeResearchSchema.ts';

// One URL per entity, retaining every collected excerpt and its provenance.
export async function storeExternalDescriptions(tx:Tx,entityId:number,intakeId:string,research:any){
 if(!entityId||research?.state==='stale'||!Array.isArray(research?.sources))return;
 for(const s of research.sources){
  let address:string;
  try{
   const u=new URL(researchUrl(s.url));
   if(['2vhutemas.ru','www.2vhutemas.ru'].includes(u.hostname))continue;
   u.hash='';address=u.href.replace(/\/$/,'');
  }catch{continue;}
  const observation={id:intakeId+':'+String(research.job||'legacy')+':'+s.id,
   intake_id:intakeId,job:research.job||null,source_id:s.id,
   at:research.prepared_at||research.started_at||new Date().toISOString(),
   title:String(s.title||'').slice(0,500),excerpt:String(s.excerpt||'').slice(0,10000),
   provider:String(s.provider||''),evidence:s.evidence==='provided'?'provided':'snippet'};
  const rows=await tx`insert into app.entity_external_descriptions(id,entity_id,url,title,excerpt,provider,evidence,intake_id,observations)
   values(${crypto.randomUUID()},${entityId},${address},${observation.title},${observation.excerpt},${observation.provider},${observation.evidence},${intakeId},${JSON.stringify([observation])}::jsonb)
   on conflict(entity_id,(md5(url))) do update set
    title=case when app.entity_external_descriptions.observations @> ${JSON.stringify([{id:observation.id}])}::jsonb then app.entity_external_descriptions.title else excluded.title end,
    excerpt=case when app.entity_external_descriptions.observations @> ${JSON.stringify([{id:observation.id}])}::jsonb then app.entity_external_descriptions.excerpt else excluded.excerpt end,
    provider=excluded.provider,evidence=excluded.evidence,intake_id=excluded.intake_id,
    observations=case when app.entity_external_descriptions.observations @> ${JSON.stringify([{id:observation.id}])}::jsonb then app.entity_external_descriptions.observations else app.entity_external_descriptions.observations || excluded.observations end
   where app.entity_external_descriptions.url=excluded.url returning id`;
  if(!rows.length)throw new Error('External URL hash collision');
 }
}
