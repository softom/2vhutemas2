import { closePool, transaction } from "../src/lib/db.ts";
import { sectionPages } from "../src/lib/sectionLayouts.ts";

const [target, actor, mode] = Deno.args;
if (!target || target !== Deno.env.get("APP_API_DB_NAME") || !actor || mode !== "--apply") {
  throw new Error("Expected explicit database, contributor UID and --apply");
}
try {
  const assignments = await transaction(actor, async q => {
    const [role] = await q`select 1 from app.contributors c join app.user_roles ur on ur.contributor_id=c.id
      join app.role_permissions rp on rp.role_id=ur.role_id join app.permissions p on p.id=rp.permission_id
      where c.id=${actor} and c.status='active' and ur.revoked_at is null and p.action='su' limit 1`;
    if (!role) throw new Error("A contributor with su is required");
    const result = [];
    for (const [path, definition] of Object.entries(sectionPages)) {
      const [page] = await q`select current_layout_id from app.pages where id=${definition.id} for update`;
      if (!page) throw new Error("Missing section page from migration 0065: " + path);
      if (page.current_layout_id) { result.push([path, page.current_layout_id]); continue; }
      await q`insert into app.widgets(name,renderer_key) values(${definition.title},${definition.widget})
        on conflict(renderer_key) do nothing`;
      const [layout] = await q`insert into app.layouts(page_id,name) values(${definition.id},${definition.title}) returning id`;
      await q`insert into app.page_layout(layout_id,widget_id,sort_order,row_start,column_start,row_span,column_span,design)
        select ${layout.id},id,1,1,1,1,3,'compact' from app.widgets where renderer_key=${definition.widget}`;
      await q`update app.pages set current_layout_id=${layout.id} where id=${definition.id}`;
      result.push([path, layout.id]);
    }
    return result;
  });
  console.log(JSON.stringify(assignments));
} finally { await closePool(); }
