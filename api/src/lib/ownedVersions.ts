/**
 * Владение версиями: сущность и связь сами хранят рабочую и публичную
 * редакции (Р-78).
 *
 * Прежде публикацией управлял материал; теперь публикуется владелец целиком
 * вместе со своим МультиТекстом, а реестр материалов остаётся ради прежних
 * UID, авторских подписей и независимых объектов — медиа и отдельных
 * документов.
 */
import { type Tx } from "./db.ts";
import { ApiError } from "./errors.ts";
import {sourceMarks} from "./linkCitations.ts";

/** Строка реестра сохраняет старые ID и подписи. Публикацией управляет владелец. */
export async function ownedMaterial(tx: Tx, materialId: string) {
  const rows = await tx<{entity_id: number|null;link_id: number|null;document_id: number|null}>`
    select entity_id,link_id,document_id from app.materials where id=${materialId} for update`;
  const m=rows[0];
  if (!m) throw new ApiError("not_found","Материал не найден");
  // Прежний текст принадлежит записи или связи — это записано в самом
  // документе (Р-84). Отдельно его не публикуют и не правят.
  if (m.document_id) {
    const owners = await tx<{ entity_id: number | null; link_id: number | null }>`
      select owner_entity_id as entity_id, owner_link_id as link_id
        from app.documents where id = ${m.document_id}
         and (owner_entity_id is not null or owner_link_id is not null)`;
    if (owners.length) throw new ApiError("owned_content", "Текст публикуется и редактируется вместе с владельцем", owners[0]);
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
  const state = owner.entity_id
    ? await tx`select status from app.entities where id=${owner.entity_id} for update`
    : await tx`select status from app.links where id=${owner.link_id} for update`;
  if (state[0]?.status === "archived") throw new ApiError("validation_failed", "Запись в корзине. Сначала восстановите её в черновик.");
  const revisions=await tx`select id from app.revisions where id=${revisionId}
    and ((${owner.entity_id}::bigint is not null and entity_id=${owner.entity_id})
      or (${owner.link_id}::bigint is not null and link_id=${owner.link_id})) and schema_version=2`;
  if (!revisions.length) throw new ApiError("validation_failed","Нужна полная версия этого владельца");
  if(owner.entity_id){
    const missing=await tx<any>`select coalesce(i.label_override,p.title_ru) as title from app.entities e
     join app.parameter_sets s on s.id in(select set_id from app.entity_parameter_sets where entity_id=e.id union select set_id from app.type_parameter_sets where type_id in(select app.entity_type_ancestors(e.type_id)))
     join app.parameter_set_items i on i.set_id=s.id and i.is_required join app.parameters p on p.id=i.parameter_id
     where e.id=${owner.entity_id} and s.result_kind='parameter_values' and not exists(
      select 1 from app.revisions r cross join lateral jsonb_array_elements(coalesce(r.snapshot->'values','[]')) v
      where r.id=${revisionId} and v->>'parameter_id'=p.id::text and (v->>'text_value' is null or length(btrim(v->>'text_value'))>0))`;
    if(missing.length)throw new ApiError('validation_failed','Не заполнены обязательные параметры: '+missing.map((r:any)=>r.title).join(', '));
  }
  if (owner.entity_id) await tx`update app.entities set status='published',published_revision_id=${revisionId} where id=${owner.entity_id}`;
  else await tx`update app.links set status='published',published_revision_id=${revisionId} where id=${owner.link_id}`;
}

/**
 * Снятие с публикации: запись или связь возвращается в черновик.
 *
 * Версии не трогаются — снимается только указатель публикации, и читатель
 * больше её не видит. В журнал рассмотрений пишется, кто и какую редакцию
 * снял: история публикаций остаётся полной. Опубликовать снова можно тем
 * же маршрутом публикации.
 */
export async function unpublishOwner(
  tx: Tx,
  owner: { kind: "entity" | "link"; id: number },
  contributorId: string,
  note: string | null,
): Promise<{ unpublished_revision_id: string; status: "draft" }> {
  const table = owner.kind === "entity" ? "сущность" : "связь";
  const rows = owner.kind === "entity"
    ? await tx<{ status: string; published_revision_id: string | null }>`
        select status, published_revision_id from app.entities where id = ${owner.id} for update`
    : await tx<{ status: string; published_revision_id: string | null }>`
        select status, published_revision_id from app.links where id = ${owner.id} for update`;
  if (rows.length === 0) throw new ApiError("not_found", `Не найдена ${table}`);
  const current = rows[0];
  if (current.status !== "published" || !current.published_revision_id) {
    throw new ApiError("duplicate", "Запись не опубликована");
  }

  if (owner.kind === "entity") {
    await tx`update app.entities set status = 'draft', published_revision_id = null where id = ${owner.id}`;
  } else {
    await tx`update app.links set status = 'draft', published_revision_id = null where id = ${owner.id}`;
  }
  await tx`
    insert into app.revision_reviews (revision_id, reviewer_id, decision, note)
    values (${current.published_revision_id}, ${contributorId}, 'unpublished', ${note})
  `;
  return { unpublished_revision_id: current.published_revision_id, status: "draft" };
}

/**
 * Публикация выбранной редакции владельцем.
 *
 * Порядок один для сущности и связи: взять редакцию (по умолчанию — рабочую),
 * убедиться, что она принадлежит этому владельцу и является полной, и
 * переключить указатель. Отметка о решении пишется в общий журнал
 * рассмотрений: кто принял версию, видно и после следующих правок.
 */
export async function publishOwnerRevision(
  tx: Tx,
  owner: { kind: "entity" | "link"; id: number },
  revisionId: string | undefined,
  contributorId: string,
  note: string | null,
): Promise<{ published_revision_id: string; status: "published" }> {
  const table = owner.kind === "entity" ? "сущность" : "связь";
  const rows = owner.kind === "entity"
    ? await tx<{ status: string; published_revision_id: string | null; working_revision_id: string | null }>`
        select status, published_revision_id, working_revision_id
          from app.entities where id = ${owner.id} for update`
    : await tx<{ status: string; published_revision_id: string | null; working_revision_id: string | null }>`
        select status, published_revision_id, working_revision_id
          from app.links where id = ${owner.id} for update`;
  if (rows.length === 0) throw new ApiError("not_found", `Не найдена ${table}`);
  const current = rows[0];

  // По умолчанию публикуется то, что сейчас в работе: это привычное «сохранил
  // и опубликовал». Явно указанная версия позволяет вернуть прежнюю редакцию.
  const chosen = revisionId ?? current.working_revision_id;
  if (!chosen) throw new ApiError("validation_failed", `У этой записи нет ни одной версии`);
  if (current.status === "published" && current.published_revision_id === chosen) {
    throw new ApiError("duplicate", "Эта версия уже опубликована");
  }

  if (owner.kind === "entity") {
    await publishVisibleMedia(tx, owner.id, chosen, contributorId);
    await publishAcceptedAttributions(tx, owner.id, chosen, contributorId);
  }

  // Проверку принадлежности и полноты версии делает publishOwned: он же
  // единственное место, где меняется указатель публикации.
  await publishOwned(tx, {
    entity_id: owner.kind === "entity" ? owner.id : null,
    link_id: owner.kind === "link" ? owner.id : null,
  }, chosen);

  await tx`
    insert into app.revision_reviews (revision_id, reviewer_id, decision, note)
    values (${chosen}, ${contributorId}, 'published', ${note})
  `;
  return { published_revision_id: chosen, status: "published" };
}

/** Publish the exact working media shown with the card, never its author/related graph. */
export async function publishMediaRecord(tx: Tx, id: number, actor: string, note: string) {
  const rows = await tx<{status: string; working_revision_id: string | null; published_revision_id: string | null}>`
    select e.status,e.working_revision_id,e.published_revision_id from app.entities e
    join app.media_assets a on a.entity_id=e.id and a.archived_at is null
    where e.id=${id} for update of e`;
  const media = rows[0];
  if (!media || media.status === 'archived' || !media.working_revision_id)
    throw new ApiError('validation_failed','Иллюстрация недоступна. Проверьте состав публикации.');
  const ready = await tx`select a.id from app.media_assets a where a.entity_id=${id}
    and a.archived_at is null and exists(select 1 from app.media_files f where f.asset_id=a.id
      and f.variant='original' and f.is_current and f.status='ready')`;
  if (!ready.length) throw new ApiError('validation_failed','Файл иллюстрации не готов. Публикация отменена.');
  if (media.status === 'published' && media.published_revision_id === media.working_revision_id) return;
  await publishOwned(tx,{entity_id:id,link_id:null},media.working_revision_id);
  await tx`insert into app.revision_reviews(revision_id,reviewer_id,decision,note)
    values(${media.working_revision_id},${actor},'published',${note})`;
}

export async function publishVisibleMedia(tx: Tx, id: number, revision: string, actor: string) {
  const links = await tx<{id: number; to_entity_id: number; working_revision_id: string; published_revision_id: string | null; status: string}>`
    select l.id,l.to_entity_id,l.working_revision_id,l.published_revision_id,l.status
    from app.links l join app.link_roles r on r.id=l.role_id
    join app.entities image on image.id=l.to_entity_id and image.status<>'archived'
    where l.from_entity_id=${id} and r.code in ('illustration','drawing') and l.status<>'archived'
    order by l.id for update of l`;
  const bodies = await tx<{snapshot: unknown}>`select snapshot from app.revisions
    where id=${revision} and entity_id=${id}`;
  const assets = new Set<string>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const object = value as Record<string, unknown>;
    if (typeof object.assetId === 'string' && object.assetId) assets.add(object.assetId);
    Object.values(object).forEach(visit);
  };
  visit(bodies[0]?.snapshot);
  const mediaIds = new Set(links.map(l => Number(l.to_entity_id)));
  for (const asset of assets) {
    const rows = await tx<{entity_id: number}>`select entity_id from app.media_assets
      where id::text=${asset} and archived_at is null`;
    if (!rows.length) throw new ApiError('validation_failed','Файл из текста недоступен. Проверьте публикацию.');
    mediaIds.add(Number(rows[0].entity_id));
  }
  for (const mediaId of [...mediaIds].sort((a,b)=>a-b))
    await publishMediaRecord(tx,mediaId,actor,`В составе публикации записи ${id}`);
  for (const link of links) {
    if (link.status==='published' && link.published_revision_id===link.working_revision_id) continue;
    await publishOwnerRevision(tx,{kind:'link',id:Number(link.id)},link.working_revision_id,actor,`В составе публикации записи ${id}`);
  }
}

/** Only links accepted into this exact entity revision, never all graph neighbours. */
export async function publishAcceptedAttributions(tx:Tx,id:number,revision:string,actor:string){
 const rows=await tx<any>`select (v->>'text_value')::jsonb as state from app.revisions r
 cross join lateral jsonb_array_elements(coalesce(r.snapshot->'values','[]')) v
 join app.parameters p on p.id::text=v->>'parameter_id'
 where r.id=${revision} and r.entity_id=${id} and p.code='research_state'`;
 const accepted=new Map<number,string>();
 for(const row of rows)for(const item of row.state.accepted_attributions||[]){
  if(item.revision_id&&Number.isSafeInteger(Number(item.link_id)))accepted.set(Number(item.link_id),item.revision_id);
 }
 for(const [linkId,version] of [...accepted].sort((a,b)=>a[0]-b[0])){
  const [link]=await tx<any>`select l.*,r.snapshot->'body_json' as body from app.links l
   join app.revisions r on r.link_id=l.id and r.id=${version}
   where l.id=${linkId} and l.from_entity_id=${id} for update of l`;
  if(!link||link.status==='archived')throw new ApiError('validation_failed',`Принятая связь №${linkId} удалена или недоступна. Публикация отменена.`);
  if(link.working_revision_id!==version)throw new ApiError('version_conflict',`Связь №${linkId} изменилась после принятия исследования. Публикация отменена.`);
  const [concept]=await tx<any>`select status from app.entities where id=${link.to_entity_id}`;
  if(concept?.status!=='published')throw new ApiError('validation_failed',`Понятие связи №${linkId} ещё не опубликовано. Публикация карточки отменена.`);
  for(const {props} of sourceMarks(link.body)){
   const [source]=await tx<any>`select status,published_revision_id from app.entities where id=${Number(props.entityId)}`;
   if(source?.status!=='published'||props.sourceRevisionId&&source.published_revision_id!==props.sourceRevisionId)throw new ApiError('validation_failed',`Источник связи №${linkId} ещё не опубликован в принятой версии. Публикация карточки отменена.`);
  }
  if(link.status==='published'&&link.published_revision_id===version)continue;
  await publishOwnerRevision(tx,{kind:'link',id:linkId},version,actor,`Принятая атрибуция в составе записи ${id}`);
 }
}
