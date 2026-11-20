import assert from "node:assert/strict";
import { Hono } from "hono";
import { closePool, sql, transaction } from "../src/lib/db.ts";
import { type AppEnv, handleError } from "../src/lib/http.ts";
import { publishOwnerRevision } from "../src/lib/ownedVersions.ts";
import { entities } from "../src/routes/entities.ts";
import { pages } from "../src/routes/pages.ts";

Deno.test("nested text stops at the current ancestor and preserves independent siblings", async () => {
  if (!Deno.env.get("APP_API_DB_NAME")?.startsWith("widget_stage")) throw Error("Restored widget_stage database required");
  try {
    const [actor] = await sql<{id:string}>`select id from app.contributors where status='active' limit 1`;
    const [widget] = await sql<{id:string}>`select id from app.widgets where renderer_key='text'`;
    const app = new Hono<AppEnv>();
    app.onError(handleError);
    app.use("*", async (c,next) => {
      c.set("principal", c.req.header("test-editor") ? {
        authUid:actor.id, contributorId:actor.id, status:"active", displayName:"Test", permissions:new Set(["su"]),
      } : null);
      await next();
    });
    app.route("/api/v1/entities", entities);
    app.route("/", pages);
    async function edit(path:string, method:string, body:unknown) {
      const res = await app.request("/api/v1/entities"+path,{method,headers:{"test-editor":"1","content-type":"application/json"},body:JSON.stringify(body)});
      const data = await res.json();
      assert.ok(res.ok, JSON.stringify(data));
      return data;
    }
    const suffix = crypto.randomUUID();
    const create = (name:string) => edit("", "POST", {
      type:"what", slug:name+"-"+suffix, title_ru:name,
    });
    const a = await create("cycle-a");
    const b = await create("cycle-b");
    const publish = (id:number,revision:string) => transaction(actor.id,tx =>
      publishOwnerRevision(tx,{kind:"entity",id},revision,actor.id,null));
    await publish(a.id,a.revision_id);
    await publish(b.id,b.revision_id);
    const para = (text:string) => ({type:"paragraph",id:crypto.randomUUID(),content:[{type:"text",text,styles:{}}]});
    const embed = (id:number) => ({type:"widget",id:crypto.randomUUID(),props:{widget_id:widget.id,entity_id:String(id)}});
    const save = async (record:typeof a,body:unknown[]) => {
      const rev = await edit("/"+record.id,"PATCH",{base_revision_id:record.revision_id,body_json:body});
      await publish(record.id,rev.revision_id);
    };
    await save(b,[para("B-start"),embed(a.id),para("B-end")]);
    await save(a,[para("A-start"),embed(a.id),embed(b.id),embed(b.id),para("A-end")]);
    function check(html:string) {
      assert.deepEqual(html.match(/<p>[AB]-(?:start|end)<\/p>/g),[
        "<p>A-start</p>", "<p>B-start</p>", "<p>B-end</p>",
        "<p>B-start</p>", "<p>B-end</p>", "<p>A-end</p>",
      ]);
      assert.equal(html.split('class="document-widget"').length-1,2);
    }
    const reader = await app.request("/entities/cycle-a-"+suffix);
    assert.equal(reader.status,200);
    check(await reader.text());
    const preview = await app.request("/api/v1/document-widgets/"+widget.id+"/preview?entity_id="+a.id,
      {headers:{"test-editor":"1"}});
    assert.equal(preview.status,200);
    check((await preview.json()).html);
  } finally { await closePool(); }
});
