import { closePool, transaction, type Tx } from "../src/lib/db.ts";
import { modelPages, modelPath } from "../src/lib/modelWidgets.ts";
import { saveRefs } from "../src/routes/documents.ts";
import { saveRevision } from "../src/lib/records.ts";
import { publishOwnerRevision } from "../src/lib/ownedVersions.ts";
import { validateDocumentWidgets } from "../src/lib/documentWidgets.ts";

async function inventory(tx: Tx) {
  return await tx<{kind:string;owner:string;version:string;revision:string|null;occurrences:number;blocks:{block_id:string;src:string}[]}>`
    with bodies(kind,owner,version,revision,body) as (
      select 'entity',i.entity_id,'value',null::uuid,v.blocks_value from app.indicator_values v
        join app.indicators i on i.id=v.indicator_id where v.blocks_value is not null
      union all
      select owners.kind,owners.id,head.version,r.id,r.snapshot->'body_json'
        from (select 'entity' kind,id,working_revision_id,published_revision_id from app.entities
              union all select 'link',id,working_revision_id,published_revision_id from app.links) owners
        cross join lateral (values ('working',working_revision_id),('published',published_revision_id)) head(version,id)
        join app.revisions r on r.id=head.id
      union all
      select 'document',d.id,'value',null::uuid,d.body_json from app.documents d
      union all
      select 'document',m.document_id,'published',r.id,r.snapshot->'body_json'
        from app.materials m join app.revisions r on r.id=m.published_revision_id where m.document_id is not null
    )
    select kind,owner::text,version,revision,jsonb_array_length(matches) as occurrences,
      (select jsonb_agg(jsonb_build_object('block_id',b->>'id','src',b->'props'->>'src') order by pos)
        from jsonb_array_elements(matches) with ordinality t(b,pos)) as blocks
      from bodies cross join lateral
        (select jsonb_path_query_array(body,'strict $.** ? (@.type == "modelEmbed")') matches) found
      where jsonb_array_length(matches)>0 order by kind,owner,version`;
}

type Block = {type?:string; props?:Record<string,unknown>; children?:Block[]};
function convert(blocks: Block[], widgets: Map<string,string>): Block[] {
  return blocks.map(block => {
    const next = {...block};
    if (block.children?.length) next.children = convert(block.children, widgets);
    if (block.type !== "modelEmbed") return next;
    const {src, title = "", caption = "", height = "", ...unknown} = block.props ?? {};
    const id = widgets.get(String(src));
    if (!id || Object.keys(unknown).length || typeof title !== "string" || typeof caption !== "string" ||
        !["number","string"].includes(typeof height)) throw Error("Unsupported model properties: " + src);
    return {...next, type:"widget", props:{widget_id:id, title, caption, height:String(height)}};
  });
}

const [target, mode = "--dry-run", actor, ...extra] = Deno.args;
if (!target || target !== Deno.env.get("APP_API_DB_NAME") || extra.length ||
    !(mode === "--dry-run" && !actor || mode === "--apply" && actor)) {
  throw Error("Usage: migrateModelEmbeds.ts <APP_API_DB_NAME> --dry-run | --apply <contributor UID>");
}
try {
  const result = await transaction(actor ?? null, async tx => {
    if (mode === "--apply") {
      const [role] = await tx`select 1 from app.contributors c join app.user_roles ur on ur.contributor_id=c.id
        join app.role_permissions rp on rp.role_id=ur.role_id join app.permissions p on p.id=rp.permission_id
        where c.id=${actor} and c.status='active' and ur.revoked_at is null and p.action='su' limit 1`;
      if (!role) throw Error("Active contributor with su required");
      await tx`select pg_advisory_xact_lock(hashtextextended('modelEmbed migration',0))`;
    }
    const materials = await inventory(tx);
    if (mode === "--dry-run") return {database:target, mode, materials};
    if (materials.some(r => r.kind !== "entity")) throw Error("Non-entity document requires separate review");
    const widgets = new Map<string,string>();
    for (const src of new Set(materials.flatMap(r => r.blocks.map(b => b.src)))) {
      const key = Object.keys(modelPages).find(k => modelPath(k) === src);
      if (!key) throw Error("Unknown model URL: " + src);
      await tx`insert into app.widgets(name,renderer_key) values(${modelPages[key]},${key}) on conflict(renderer_key) do nothing`;
      const [row] = await tx<{id:string}>`select id from app.widgets where renderer_key=${key}`;
      widgets.set(src,row.id);
    }
    const migrated = [];
    for (const owner of new Set(materials.map(r => r.owner))) {
      const id = Number(owner);
      await tx`select id from app.materials where entity_id=${id} for update`;
      const [e] = await tx<{working_revision_id:string;published_revision_id:string|null}>`select working_revision_id,published_revision_id
        from app.entities where id=${id} for update`;
      if (!e || (e.published_revision_id && e.working_revision_id !== e.published_revision_id)) {
        throw Error("Working and published heads need separate review for " + owner);
      }
      const rows = await tx<{id:string;body:Block[];matches:boolean}>`select v.id,v.blocks_value body,
        v.blocks_value = r.snapshot->'body_json' as matches from app.indicator_values v
        join app.indicators i on i.id=v.indicator_id join app.parameters p on p.id=v.parameter_id
        join app.revisions r on r.id=${e.working_revision_id} where i.entity_id=${id} and p.code='text' and v.blocks_value is not null for update of v`;
      if (rows.length !== 1 || !rows[0].matches) throw Error("Text differs from working snapshot for " + owner);
      const body = convert(rows[0].body,widgets);
      await validateDocumentWidgets(tx,body);
      await tx`update app.indicator_values set blocks_value=${JSON.stringify(body)}::jsonb where id=${rows[0].id}`;
      const revision = await saveRevision(tx,id,actor!,"Перенос вставок интерактивных моделей");
      await saveRefs(tx,revision,body);
      if (e.published_revision_id) await publishOwnerRevision(tx,{kind:"entity",id},revision,actor!, "Перенос вставок интерактивных моделей");
      migrated.push({owner,previous:e.working_revision_id,revision});
    }
    if ((await inventory(tx)).length) throw Error("Unconverted modelEmbed blocks remain");
    return {database:target,mode,migrated};
  });
  console.log(JSON.stringify(result,null,2));
} finally { await closePool(); }
