import type { Tx } from './db.ts';
import { ApiError } from './errors.ts';
import { createLink } from './records.ts';

type Dossier = { sources: { media: { media_entity_id?: number | null; url?: string }[] }[]; sketch?: { target_entity_id?: number | null } };

/** The returned revision manifest is rendered in the sketch and checked on approval. */
export async function intakeMedia(tx: Tx, d: Dossier) {
  const ids = [...new Set(d.sources.flatMap(s=>s.media.map(m=>m.media_entity_id).filter(Boolean)))];
  return await tx<{id:number;asset_id:string;title:string;revision_id:string;status:string}>`
    select distinct e.id,a.id as asset_id,e.title_ru as title,e.working_revision_id as revision_id,e.status
    from app.entities e join app.media_assets a on a.entity_id=e.id and a.archived_at is null
    where e.status<>'archived' and (e.id=any(${ids}::bigint[]) or e.id in
      (select l.to_entity_id from app.links l join app.link_roles r on r.id=l.role_id
       where l.from_entity_id=${d.sketch?.target_entity_id ?? null} and l.status<>'archived'
         and r.code in ('illustration','drawing'))) order by e.id,a.id`;
}

export function mediaManifest(rows: {id:number;asset_id:string;revision_id:string}[]) {
  return rows.map(m=>`${m.id}:${m.asset_id}:${m.revision_id}`).sort();
}

export async function attachIntakeMedia(tx: Tx, d: Dossier, id: number, actor: string) {
  const entries = d.sources.flatMap(s=>s.media);
  if (entries.some(m=>!m.media_entity_id))
    throw new ApiError('validation_failed','В эскизе есть незагруженные медиа. Сохраните их в медиатеке или уберите из состава перед публикацией.');
  for (const mediaId of [...new Set(entries.map(m=>Number(m.media_entity_id)))].sort((a,b)=>a-b)) {
    const rows=await tx<{asset_class:string}>`select a.asset_class from app.media_assets a
      join app.entities e on e.id=a.entity_id where a.entity_id=${mediaId} and a.archived_at is null and e.status<>'archived'`;
    if (!rows.length) throw new ApiError('validation_failed','Медиа эскиза недоступно. Обновите состав публикации.');
    const role=rows[0].asset_class==='drawing'?'drawing':'illustration';
    const existing=await tx`select l.id from app.links l join app.link_roles r on r.id=l.role_id
      where l.from_entity_id=${id} and l.to_entity_id=${mediaId} and r.code=${role} and l.status<>'archived'`;
    if (existing.length) continue;
    const next=await tx<{n:number}>`select coalesce(max(sort_order),-1)+1 as n from app.links where from_entity_id=${id}`;
    await createLink(tx,{from:id,to:mediaId,role,justification:'Иллюстрация, утверждённая в эскизе',
      contributorId:actor,sortOrder:Number(next[0].n),publish:false});
  }
}
