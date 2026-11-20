import { closePool, sql } from "../src/lib/db.ts";

const [database, mode = "--dry-run", ...extra] = Deno.args;
if (!database || database !== Deno.env.get("APP_API_DB_NAME") || mode !== "--dry-run" || extra.length) {
  throw new Error("Usage: migrateModelEmbeds.ts <APP_API_DB_NAME> --dry-run");
}

try {
  // Compare the editable value with both heads. Historical revisions stay readable as written.
  const rows = await sql`
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
  console.log(JSON.stringify({database, mode, materials:rows}, null, 2));
} finally {
  await closePool();
}
