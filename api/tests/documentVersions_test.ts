import assert from "node:assert/strict";
import { Hono } from "hono";
import { type AppEnv, handleError } from "../src/lib/http.ts";
import { closePool, sql } from "../src/lib/db.ts";
import { entities } from "../src/routes/entities.ts";
import { materials } from "../src/routes/materials.ts";
import { pages } from "../src/routes/pages.ts";

Deno.test("history restores widget calls and all nine historical models of lecture 563", async () => {
  if (!Deno.env.get("APP_API_DB_NAME")?.startsWith("widget_stage54_") || Deno.env.get("INDEXNOW_KEY")) {
    throw Error("Dedicated stage 5.4 copy with IndexNow disabled required");
  }
  try {
    const [actor] = await sql<{id:string}>`select id from app.contributors where status='active' limit 1`;
    const app = new Hono<AppEnv>();
    app.onError(handleError);
    app.use("*", async (c,next) => {
      c.set("principal", c.req.header("test-editor") ? { authUid:actor.id, contributorId:actor.id,
        displayName:"Test",status:"active",permissions:new Set(["su"]) } : null);
      await next();
    });
    app.route("/api/v1/entities",entities);
    app.route("/api/v1/materials",materials);
    app.route("/",pages);
    async function api(path:string, method="GET", body?:unknown) {
      const response = await app.request("/api/v1/"+path,{method,headers:{"content-type":"application/json","test-editor":"1"},
        body:body === undefined ? undefined : JSON.stringify(body)});
      const data = await response.json();
      assert.ok(response.ok,JSON.stringify(data));
      return data;
    }
    async function reader(slug:string) {
      const response = await app.request("/entities/"+slug);
      assert.equal(response.status,200);
      return await response.text();
    }
    const [widget] = await sql<{id:string}>`select id from app.widgets where renderer_key='record_compact'`;
    const slug = "history-"+crypto.randomUUID();
    const original = [{type:"widget",id:crypto.randomUUID(),props:{widget_id:widget.id,entity_id:"188",design:"compact"}}];
    const owner = await api("entities","POST",{type:"what",slug,title_ru:"Контроль истории",body_json:original});
    const later = await api("entities/"+owner.id,"PATCH",{base_revision_id:owner.revision_id,body_json:[]});
    const publish = (material:string, revision:string) => api("materials/"+material+"/publish","POST",{revision_id:revision});
    await publish(owner.material_id,later.revision_id);
    assert.ok(!(await reader(slug)).includes('class="document-widget"'));
    await publish(owner.material_id,owner.revision_id);
    assert.ok((await reader(slug)).includes('class="document-widget"'));
    const bodyPath = "entities/"+owner.id+"/versions/"+owner.revision_id+"/body";
    const saved = await api(bodyPath);
    assert.deepEqual(saved.body,original);
    assert.equal((await app.request("/api/v1/"+bodyPath)).status,401);
    assert.equal((await app.request("/api/v1/entities/563/versions/"+owner.revision_id+"/body",{headers:{"test-editor":"1"}})).status,404);
    const restored = await api("entities/"+owner.id,"PATCH",{base_revision_id:later.revision_id,body_json:saved.body});
    const refs = await sql`select block_id,entity_id::text target from app.document_entity_refs where revision_id=${restored.revision_id}`;
    assert.equal(refs.length,1);
    assert.equal(refs[0].block_id,original[0].id);
    assert.equal(refs[0].target,"188");

    const [lecture] = await sql<{slug:string; material:string; live:string; working:string}>`select e.slug,m.id material,
      e.published_revision_id live,e.working_revision_id working from app.entities e join app.materials m on m.entity_id=e.id where e.id=563`;
    const history = await sql<{id:string; models:number}>`select r.id,jsonb_array_length(jsonb_path_query_array(
      r.snapshot,'strict $.body_json.** ? (@.type == "modelEmbed")')) models from app.revisions r
      where r.entity_id=563 and r.schema_version=2 and r.id<>${lecture.live} order by r.created_at desc`;
    const older = history.find(row => row.models===9)!, empty = history.find(row => row.models===0)!;
    const models = await sql<{src:string}>`select b->'props'->>'src' src from app.revisions r,
      jsonb_path_query(r.snapshot,'strict $.body_json.** ? (@.type == "modelEmbed")') b where r.id=${older.id}`;
    try {
      await publish(lecture.material,empty.id);
      assert.ok(!(await reader(lecture.slug)).includes('class="model-embed"'));
      await publish(lecture.material,older.id);
      const html = await reader(lecture.slug);
      const frames = [...html.matchAll(/<iframe src="(\/models\/[^"]+)\?embed=1"/g)].map(match => match[1]);
      assert.deepEqual(frames,models.map(row => row.src));
      assert.equal(frames.length,9);
      for (const src of frames) assert.ok(html.includes('href="'+src+'"'));
      console.log("Verified lecture",older.id,frames.join(", "));
    } finally {
      const [current] = await sql`select published_revision_id from app.entities where id=563`;
      if (current.published_revision_id !== lecture.live) await publish(lecture.material,lecture.live);
    }
    const [end] = await sql`select published_revision_id,working_revision_id from app.entities where id=563`;
    assert.equal(end.published_revision_id,lecture.live);
    assert.equal(end.working_revision_id,lecture.working);
  } finally { await closePool(); }
});
