import assert from "node:assert/strict";
import { Hono } from "hono";
import { closePool, sql, transaction } from "../src/lib/db.ts";
import { type AppEnv, handleError } from "../src/lib/http.ts";
import { publishOwnerRevision, unpublishOwner } from "../src/lib/ownedVersions.ts";
import { entities } from "../src/routes/entities.ts";
import { pages } from "../src/routes/pages.ts";

Deno.test("public document widgets follow target publication; only editors see withdrawal reasons", async () => {
  if (!Deno.env.get("APP_API_DB_NAME")?.startsWith("widget_stage")) throw Error("Restored widget_stage database required");
  try {
    const [actor] = await sql<{id:string}>`select id from app.contributors where status='active' limit 1`;
    const [widget] = await sql<{id:string}>`select id from app.widgets where renderer_key='record_compact'`;
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
    const nonce = crypto.randomUUID();
    const publicTitle = "PUBLIC-"+nonce, privateTitle = "DRAFT-"+nonce;
    const target = await edit("","POST",{type:"what",slug:"target-"+nonce,title_ru:publicTitle});
    const publish = (id:number,rev:string) => transaction(actor.id,tx=>publishOwnerRevision(tx,{kind:"entity",id},rev,actor.id,null));
    await publish(target.id,target.revision_id);
    const slug = "document-"+nonce;
    const widgetBlock = () => ({id:crypto.randomUUID(),type:"widget",props:{widget_id:widget.id,entity_id:String(target.id),design:"compact"}});
    const owner = await edit("","POST",{type:"what",slug,title_ru:"Контроль Мультитекста",body_json:[
      {type:"paragraph",content:[{type:"text",text:"Обычный абзац",styles:{}}],children:[widgetBlock()]},widgetBlock(),
    ]});
    await publish(owner.id,owner.revision_id);
    const draft = await edit("/"+target.id,"PATCH",{base_revision_id:target.revision_id,title_ru:privateTitle});
    const reader = async () => {
      const res = await app.request("/entities/"+slug);
      assert.equal(res.status,200);
      return await res.text();
    };
    const previewPath = "/api/v1/document-widgets/"+widget.id+"/preview?entity_id=";
    const preview = async (id:number) => await (await app.request(previewPath+id,{headers:{"test-editor":"1"}})).json();
    const live = await reader();
    assert.ok(live.includes(publicTitle) && !live.includes(privateTitle));
    assert.equal(live.split('class="document-widget"').length-1,2);
    await transaction(actor.id,tx=>unpublishOwner(tx,{kind:"entity",id:target.id},actor.id,null));
    async function hidden() {
      const html = await reader();
      assert.ok(html.includes("Обычный абзац"));
      for (const value of ['class="document-widget"',publicTitle,privateTitle,"target-"+nonce,widget.id]) assert.ok(!html.includes(value),value);
    }
    await hidden();
    assert.equal((await preview(target.id)).reason,"Черновик");
    await edit("/"+target.id+"/archive","POST",{base_revision_id:draft.revision_id});
    await hidden();
    const archived = await preview(target.id);
    assert.deepEqual(archived,{html:"",title:"",reason:"Удалена"});
    assert.equal((await preview(999999999)).error.message,"Недоступна");
    assert.equal((await app.request(previewPath+target.id)).status,401);
  } finally { await closePool(); }
});
