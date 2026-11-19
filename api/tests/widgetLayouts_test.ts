import { Hono } from "hono";
import type { AppEnv } from "../src/lib/http.ts";
import { handleError } from "../src/lib/http.ts";
import { layoutAdmin } from "../src/routes/layoutAdmin.ts";
import { closePool, sql } from "../src/lib/db.ts";
import { CARD_PAGE_ID, getCardLayout, getPageLayout } from "../src/lib/layouts.ts";
import { getWidget, widgetImplementations } from "../src/lib/widgetRegistry.ts";

// This suite commits changes and therefore runs only on a disposable restored DB.
if (!Deno.env.get("APP_API_DB_NAME")?.startsWith("widget_0065_integration_")) {
  throw new Error("Dedicated restored test database required");
}
function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
Deno.test("layouts: routes, permissions, inheritance, versions and concurrent edits", async () => {
  try {
    const [author] = await sql<{ id: string }>`select id from app.contributors limit 1`;
    const app = new Hono<AppEnv>();
    app.onError(handleError);
    app.use("*", async (c, next) => {
      const role = c.req.header("test-role");
      c.set(
        "principal",
        role
          ? {
            authUid: author.id,
            contributorId: author.id,
            displayName: "test",
            status: "active",
            permissions: new Set(role === "su" ? ["su"] : ["edit"]),
          }
          : null,
      );
      await next();
    });
    app.route("/admin", layoutAdmin);
    async function req(path: string, body: unknown, status: number, method = "POST", role = "su") {
      const res = await app.request("/admin" + path, {
        method,
        headers: { "Content-Type": "application/json", "test-role": role },
        body: method === "GET" ? undefined : JSON.stringify(body),
      });
      const data = await res.json();
      check(res.status === status, JSON.stringify({ path, status, actual: res.status, data }));
      return data;
    }
    await req("/widgets", {}, 401, "POST", "");
    await req("/widgets", {}, 403, "POST", "edit");
    const widgets = await req("/widgets", null, 200, "GET");
    const w = await getWidget(
      widgets.find((item: { renderer_key: string }) => item.renderer_key === "style_analysis").id,
    );
    check(
      w?.renderer_key === "style_analysis" && "render" in w && typeof w.render === "function",
      "registered renderer",
    );
    await req("/widgets", { renderer_key: "params", name: "bad" }, 400);
    await req("/widgets", { renderer_key: w.renderer_key, name: "duplicate" }, 409);
    const testKey = "test_" + crypto.randomUUID().replaceAll("-", "");
    widgetImplementations.set(testKey, widgetImplementations.get("style_analysis")!);
    try {
      const created = await req(
        "/widgets",
        { renderer_key: testKey, name: "stage2-registry-test" },
        200,
      );
      check((await getWidget(created.id))?.renderer_key === testKey, "create and resolve by UID");
    } finally {
      widgetImplementations.delete(testKey);
    }
    const layout = await req("/layouts", { page_id: CARD_PAGE_ID, name: "stage2-test" }, 200);
    const slot = {
      layout_id: layout.id,
      widget_id: w.id,
      sort_order: 1,
      row_start: 1,
      column_start: 1,
      row_span: 1,
      column_span: 1,
    };
    const first = await req("/page_layout", { ...slot, expected_revision: 0 }, 200);
    await req("/page_layout", { ...slot, expected_revision: 0 }, 409);
    await req("/page_layout", { ...slot, expected_revision: 1, design: "missing" }, 400);
    await req("/page_layout", { ...slot, expected_revision: 1, sort_order: 2 }, 400);
    await req(
      "/page_layout",
      { ...slot, expected_revision: 1, column_start: 3, column_span: 2 },
      400,
    );
    await req(
      "/page_layout",
      { ...slot, expected_revision: 1, widget_id: crypto.randomUUID() },
      400,
    );
    const after = await req("/layouts/" + layout.id, null, 200, "GET");
    check(after.revision === 1 && after.slots.length === 1, "failed writes roll back");
    const writes = await Promise.all(
      [1, 2].map(() =>
        app.request("/admin/page_layout", {
          method: "POST",
          headers: { "Content-Type": "application/json", "test-role": "su" },
          body: JSON.stringify({ ...slot, sort_order: 2, column_start: 2, expected_revision: 1 }),
        })
      ),
    );
    check(writes.map((x) => x.status).sort().join(",") === "200,409", "concurrent save");
    const rev2 = await req("/layouts/" + layout.id, null, 200, "GET");
    const reordered = await req("/page_layout", {
      layout_id: layout.id,
      expected_revision: 2,
      slots: rev2.slots.map((s: Record<string, number>) => ({
        ...s,
        sort_order: 3 - s.sort_order,
        column_start: 3 - s.column_start,
      })),
    }, 200);
    const [types] = await sql<
      { parent: string; child: string }
    >`select p.id parent,t.id child from app.entity_types t
    join app.entity_types p on p.id=t.parent_id where not exists
    (select 1 from app.type_presentations tp where tp.type_id=t.id and tp.mode='card') limit 1`;
    const oldSection = async () =>
      (await sql<{ id: string }>`select app.presentation_for(${types.child},'card') id`)[0].id;
    const old = await oldSection();
    check(
      await getCardLayout(types.child) === null && await getPageLayout(CARD_PAGE_ID) === null,
      "old layout still active",
    );
    const setPage = "/pages/" + CARD_PAGE_ID + "/layout";
    await req(
      setPage,
      { layout_id: layout.id, expected_layout_id: null, expected_revision: 1 },
      409,
    );
    await req(setPage, {
      layout_id: layout.id,
      expected_layout_id: null,
      expected_revision: reordered.revision,
    }, 200);
    check((await getCardLayout(types.child))?.id === layout.id, "page fallback");
    await req("/page_layout", { ...slot, expected_revision: reordered.revision }, 409);
    const copy = await req("/layouts/" + layout.id + "/copy", { name: "stage2-variant" }, 200);
    check(
      copy.slots.length === 2 &&
        copy.slots.every((s: { id: string }) => s.id !== first.slots[0].id),
      "independent copy",
    );
    const deleted = await req(
      "/page_layout/" + copy.slots[0].id,
      { layout_id: copy.id, expected_revision: copy.revision },
      200,
      "DELETE",
    );
    const assign = (type: string) => "/type_presentations/" + type + "/layout";
    const next = {
      layout_id: copy.id,
      expected_layout_id: null,
      expected_revision: deleted.revision,
    };
    await req(assign(types.parent), next, 200);
    check((await getCardLayout(types.child))?.id === copy.id, "parent inheritance");
    await req(assign(types.child), {
      layout_id: layout.id,
      expected_layout_id: null,
      expected_revision: reordered.revision,
    }, 200);
    check(
      (await getCardLayout(types.child))?.id === layout.id && await oldSection() === old,
      "independent section inheritance",
    );
    await req(assign(types.child), { layout_id: null, expected_layout_id: layout.id }, 200);
    check((await getCardLayout(types.child))?.id === copy.id, "inheritance after reset");
    await req("/pages/39ee9267-1a0e-4928-b608-24bf91f68102/layout", next, 400);
    await req(assign(types.parent), { layout_id: null, expected_layout_id: copy.id }, 200);
    await req(setPage, { layout_id: null, expected_layout_id: layout.id }, 200);
    await req(
      "/page_layout/" + reordered.slots[0].id,
      { layout_id: layout.id, expected_revision: reordered.revision },
      409,
      "DELETE",
    );
  } finally {
    await closePool();
  }
});
