import assert from "node:assert/strict";
import { Hono } from "hono";
import { closePool, sql, transaction } from "../src/lib/db.ts";
import { type AppEnv, handleError } from "../src/lib/http.ts";
import { publishOwnerRevision } from "../src/lib/ownedVersions.ts";
import { entities } from "../src/routes/entities.ts";

Deno.test("widget blocks: atomic entity save, revision references and publication visibility", async () => {
  if (!Deno.env.get("APP_API_DB_NAME")?.startsWith("widget_stage")) throw Error("Restored widget_stage test DB required");
  try {
    const [actor] = await sql<{id:string}>`select id from app.contributors where status='active' limit 1`;
    const [widget] = await sql<{id:string}>`select id from app.widgets where renderer_key='record_compact'`;
    const [published] = await sql<{id:number}>`select id from app.entities where is_published order by id limit 1`;
    const app = new Hono<AppEnv>();
    app.onError(handleError);
    app.use("*", async (c,next) => {
      c.set("principal",{authUid:actor.id, contributorId:actor.id, status:"active", displayName:"Test",permissions:new Set(["su"])});
      await next();
    });
    app.route("/entities",entities);
    async function request(path:string, method:string, body:unknown, status:number) {
      const res = await app.request("/entities"+path,{method,headers:{"content-type":"application/json"},body:JSON.stringify(body)});
      const data = await res.json();
      assert.equal(res.status,status,JSON.stringify(data));
      return data;
    }
    const create = () => request("", "POST", {type:"what", slug:"widget-test-"+crypto.randomUUID(), title_ru:"Проверка виджета"},201);
    const owner = await create();
    const draft = await create();
    const block = (props: Record<string,unknown>) => ({type:"widget",id:crypto.randomUUID(),props:{widget_id:widget.id,...props}});
    const withTarget = block({entity_id:String(published.id),design:"compact"});
    const body = [{type:"paragraph",id:"parent",children:[withTarget,block({entity_id:Number(published.id)}),block({entity_id:"",design:""})]}];
    const save = (base:string, blocks:unknown[], status:number, title="Проверка виджета") =>
      request("/"+owner.id,"PATCH",{base_revision_id:base,title_ru:title,body_json:blocks},status);
    const first = await save(owner.revision_id,body,200);
    async function state() {
      const [row] = await sql`select title_ru,working_revision_id,published_revision_id,
        (select count(*) from app.revisions where material_id=${owner.material_id}) as revisions,
        (select jsonb_agg(to_jsonb(v) order by v.id) from app.indicators i join app.indicator_values v on v.indicator_id=i.id where i.entity_id=e.id) as vals,
        (select jsonb_agg(to_jsonb(ref) order by ordinal) from app.document_entity_refs ref where ref.revision_id=e.working_revision_id) as refs
        from app.entities e where e.id=${owner.id}`;
      return row;
    }
    const before = await state();
    assert.equal(before.working_revision_id,first.revision_id);
    assert.equal((before.refs as {block_id:string}[]).length,2);
    assert.equal((before.refs as {block_id:string}[])[0].block_id,withTarget.id);
    for (const invalid of [{widget_id:crypto.randomUUID()}, {entity_id:"999999999999999"}, {design:"unknown"}, {entity_id:true}]) {
      const result = await save(first.revision_id,[withTarget,{type:"paragraph",children:[block(invalid)]}],400,"Должно откатиться");
      assert.equal(result.error.code,"validation_failed");
      assert.deepEqual(await state(),before);
    }
    const publish = (revision:string) => transaction(actor.id, tx => publishOwnerRevision(tx,{kind:"entity",id:owner.id},revision,actor.id,null));
    await publish(first.revision_id);
    const second = await save(first.revision_id,[block({entity_id:draft.id})],200);
    const pending = await state();
    await assert.rejects(publish(second.revision_id),/недоступна/);
    assert.deepEqual(await state(),pending);
    assert.equal(pending.published_revision_id,first.revision_id);
  } finally { await closePool(); }
});
