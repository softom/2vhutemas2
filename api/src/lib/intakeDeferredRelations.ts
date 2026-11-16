import type { Tx } from './db.ts';
import { ApiError } from './errors.ts';
import { applyRelations, validateRelations } from './intakeRelations.ts';
import { publishOwnerRevision } from './ownedVersions.ts';
import { saveRefs } from '../routes/documents.ts';

type Row = Record<string, any>;

// Called under the intake approval advisory lock, after publication of either end.
// A failed proposal must not roll back the independently approved entity.
export async function applyDeferredRelations(tx:Tx, dossierId:string, actor:string, canCreate:boolean) {
 const parents=await tx<Row>`select * from app.entity_intake d
  where d.status='done' and d.target_entity_id is not null
  and exists(select 1 from jsonb_array_elements(coalesce(d.sketch->'related','[]'::jsonb)) r
   where r->>'candidate_intake_id' is not null and coalesce(r->>'confirmed','false')<>'true'
   and (d.id::text=${dossierId} or r->>'candidate_intake_id'=${dossierId}))
  order by d.id for update`;
 for(const parent of parents){
  const previous=structuredClone(parent),sk=parent.sketch;let changed=false;
  for(let i=0;i<(sk.related||[]).length;i++){
   const r=sk.related[i];if(!r.candidate_intake_id||r.confirmed)continue;
   const candidates=await tx<Row>`select target_entity_id from app.entity_intake
    where id::text=${r.candidate_intake_id} and status='done' and target_entity_id is not null`;
   if(!candidates.length)continue;
   await tx`savepoint deferred_relation`;
   try{
    if(r.kind==='author'&&!canCreate)throw new ApiError('permission_denied','Для создания связи нужны права создания записей');
    const owners=await tx<Row>`select e.id,e.is_published,e.working_revision_id,e.published_revision_id,m.id as material_id
     from app.entities e join app.materials m on m.entity_id=e.id
     where e.id=${parent.target_entity_id} and e.status<>'archived' for update of e,m`;
    const owner=owners[0];
    if(!owner?.is_published)throw new ApiError('version_conflict','Объект снят с публикации. Связь сохранена в стеке');
    // Adding a place changes the owner's snapshot. Never publish someone else's draft.
    if(r.kind==='place'&&owner.working_revision_id!==owner.published_revision_id)
     throw new ApiError('version_conflict','У объекта есть неопубликованные правки. Сначала проверьте их в каталоге');
    const [checked]=await validateRelations(tx,[{...r,entity_id:Number(candidates[0].target_entity_id),confirmed:true}],[r],sk.sources,Number(parent.target_entity_id));
    const applied=await applyRelations(tx,Number(parent.target_entity_id),[checked],actor,parent.id);
    if(r.kind==='place'&&applied.some(a=>!a.reused)){
     const data=(await tx<Row>`select app.entity_snapshot(${parent.target_entity_id}) as data`)[0].data;
     const rev=await tx<Row>`insert into app.revisions(material_id,base_revision_id,edited_by,operation,summary,snapshot)
      values(${owner.material_id},${owner.working_revision_id},${actor},'edit','Отложенное место из стека сущностей',${JSON.stringify(data)}::jsonb) returning id`;
     await saveRefs(tx,rev[0].id,data.body_json);
     await publishOwnerRevision(tx,{kind:'entity',id:Number(parent.target_entity_id)},rev[0].id,actor,'Отложенная привязка из эскиза '+parent.id);
    }
    await tx`release savepoint deferred_relation`;
    sk.related[i]=checked;sk.applied_relations=[...(sk.applied_relations||[]),...applied];changed=true;
   }catch(error){
    await tx`rollback to savepoint deferred_relation`;
    await tx`release savepoint deferred_relation`;
    if(!(error instanceof ApiError))throw error;
    const message=error.message;
    if(r.deferred_error!==message){sk.related[i]={...r,deferred_error:message};changed=true;}
   }
  }
  if(changed){
   const {history,...snapshot}=previous;
   await tx`update app.entity_intake set sketch=${JSON.stringify(sk)}::jsonb,version=version+1,
    history=history||${JSON.stringify([{at:new Date().toISOString(),by:actor,snapshot}])}::jsonb where id=${parent.id}`;
  }
 }
}
