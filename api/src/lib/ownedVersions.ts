import { type Tx } from "./db.ts";
import { ApiError } from "./errors.ts";

/** Строка реестра сохраняет старые ID и подписи. Публикацией управляет владелец. */
export async function ownedMaterial(tx: Tx, materialId: string) {
  const rows = await tx<{entity_id: number|null;link_id: number|null;document_id: number|null}>`
    select entity_id,link_id,document_id from app.materials where id=${materialId} for update`;
  const m=rows[0];
  if (!m) throw new ApiError("not_found","Материал не найден");
  if (m.document_id) {
    const owners=await tx`select t.entity_id,t.link_id from app.attachments a
      join app.targets t on t.id=a.target_id join app.attachment_roles ar on ar.id=a.role_id
      where a.document_id=${m.document_id} and ar.code in ('description','wiki','justification') limit 1`;
    if (owners.length) throw new ApiError("owned_content","Текст публикуется и редактируется вместе с владельцем",owners[0]);
  }
  if (m.entity_id) {
    const r=await tx`select id,status,published_revision_id,working_revision_id as latest_revision_id
      from app.entities where id=${m.entity_id} for update`;
    return {...r[0],kind:"entity",entity_id:m.entity_id,link_id:null};
  }
  if (m.link_id) {
    const r=await tx`select id,status,published_revision_id,working_revision_id as latest_revision_id
      from app.links where id=${m.link_id} for update`;
    return {...r[0],kind:"link",entity_id:null,link_id:m.link_id};
  }
  return null;
}

export async function publishOwned(tx: Tx, owner: {entity_id: number|null;link_id: number|null}, revisionId: string) {
  const revisions=await tx`select id from app.revisions where id=${revisionId}
    and ((${owner.entity_id}::bigint is not null and entity_id=${owner.entity_id})
      or (${owner.link_id}::bigint is not null and link_id=${owner.link_id})) and schema_version=2`;
  if (!revisions.length) throw new ApiError("validation_failed","Нужна полная версия этого владельца");
  if (owner.entity_id) await tx`update app.entities set status='published',published_revision_id=${revisionId} where id=${owner.entity_id}`;
  else await tx`update app.links set status='published',published_revision_id=${revisionId} where id=${owner.link_id}`;
}
