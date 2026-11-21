import "../src/lib/json.ts";
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
    check(layout.grid_columns === 3, "existing clients create three-column layouts");
    await req("/layouts", { page_id: CARD_PAGE_ID, name: "invalid grid", grid_columns: 5 }, 400);
    const wide = await req("/layouts", { page_id: CARD_PAGE_ID, name: "wide", grid_columns: 4 }, 200);
    await req("/page_layout", { ...slot, layout_id: wide.id, column_start: 4, expected_revision: 0 }, 200);
    const wideCopy = await req("/layouts/" + wide.id + "/copy", { name: "wide copy" }, 200);
    check(wideCopy.grid_columns === 4 && wideCopy.slots[0]?.column_start === 4, "copy preserves four-column grid");
    const model = widgets.find((item: { renderer_key: string }) => item.renderer_key === "model_grid");
    check(model.instance.display_options.height.default === 560, "model height contract");
    const instances = await req("/layouts", { page_id: CARD_PAGE_ID, name: "instance settings" }, 200);
    const save = (fields: object, revision: number, status = 200) =>
      req("/page_layout", { ...slot, layout_id: instances.id, expected_revision: revision, ...fields }, status);
    const [entity] = await sql<{ id: string }>`select id::text from app.entities order by id limit 1`;
    await save({ widget_id: model.id, display_options: { height: 400, caption: "A" } }, 0);
    const pair = await save({ widget_id: model.id, sort_order: 2, column_start: 2, display_options: { height: 700 } }, 1);
    check(pair.slots[0].display_options.height === 400 && pair.slots[1].display_options.height === 700, "independent display settings");
    const left = pair.slots[0].id;
    await save({ id: left, widget_id: model.id, display_options: { height: 319 } }, 2, 400);
    await save({ id: left, widget_id: model.id, call_params: { entity_id: entity.id } }, 2, 400);
    const moved = await save({ id: left, widget_id: model.id, row_start: 3 }, 2);
    check(moved.slots[0].display_options.caption === "A", "move preserves overrides");
    await save({ id: left, call_params: { entity_id: "9223372036854775807" } }, 3, 400);
    const changed = await save({ id: left, design: "default", call_params: { entity_id: entity.id } }, 3);
    check(Object.keys(changed.slots[0].display_options).length === 0, "replacement clears old settings");
    const calls = await save({ id: pair.slots[1].id, sort_order: 2, column_start: 2 }, 4);
    check(calls.slots[0].call_params.entity_id === entity.id && !calls.slots[1].call_params.entity_id, "independent call arguments");
    const instanceCopy = await req("/layouts/" + instances.id + "/copy", { name: "instance copy" }, 200);
    check(instanceCopy.slots[0].call_params.entity_id === entity.id && instanceCopy.slots[0].design === "default", "copy retains settings");
    const reset = await save({ id: left, call_params: {} }, 5);
    check(!reset.slots[0].call_params.entity_id && reset.slots[0].design === "default", "reset one group");
    const projectSource = "00000000-0000-4000-a000-0000000000e2";
    const authorSource = "00000000-0000-4000-a000-0000000000e1";
    for (const [page_id, source_type_id] of [
      ["39ee9267-1a0e-4928-b608-24bf91f68102", projectSource],
      ["39ee9267-1a0e-4928-b608-24bf91f68103", authorSource],
    ]) {
      const target = await req("/layouts", { page_id, name: "selection-test" }, 200);
      const save = (body: object, expected_revision: number, status = 200) => req("/page_layout",
        { layout_id: target.id, expected_revision, ...body }, status);
      const created = await save({ slots: [1, 2, 3, 4].map(i => ({
        ...slot, sort_order: i, row_start: i,
      })) }, 0);
      const [, left, right] = created.slots;
      const selection = { source_type_id, filter_type_id: source_type_id, repeat_mode: "block",
        first_slot_id: left.id, last_slot_id: right.id };
      const block = await save({ selection }, created.revision);
      const preview = (id: string) => req("/layouts/" + id + "/selection-preview", null, 200, "GET");
      const entries = (await preview(target.id)).items;
      check(entries.length >= 4 && entries[0].entity_id === entries[1].entity_id &&
        entries[2].entity_id === entries[3].entity_id && entries[0].entity_id !== entries[2].entity_id &&
        entries.every((v: {slot_id: string}, i: number) => v.slot_id === (i % 2 ? right.id : left.id)), "block repeats two slots per record");
      const foreignSource = source_type_id === projectSource ? authorSource : projectSource;
      await save({ selection: { ...selection, source_type_id: foreignSource } }, block.revision, 400);
      await save({ selection: { ...selection, filter_type_id: foreignSource } }, block.revision, 400);
      await save({ selection: { ...selection, last_slot_id: wideCopy.slots[0].id } }, block.revision, 400);
      await save({ selection: { ...selection, repeat_mode: "other" } }, block.revision, 400);
      await save({ slots: [{ ...right, sort_order: 0 }], selection }, block.revision, 400);
      await save({ selection: null }, created.revision, 409);
      const journal = await save({ selection: { ...selection, repeat_mode: "journal" } }, block.revision);
      const single = (await preview(target.id)).items;
      check(single.length * 2 === entries.length && single.every((v: {entity_id: string; slot_id: string}, i: number) =>
        v.entity_id === entries[2*i].entity_id && v.slot_id === (i % 2 ? right.id : left.id)), "journal advances each slot");
      const copy = await req("/layouts/" + target.id + "/copy", { name: "selection copy" }, 200);
      check(copy.first_slot_id === copy.slots[1].id && copy.last_slot_id === copy.slots[2].id &&
        copy.first_slot_id !== left.id && (await preview(copy.id)).items.length === single.length, "copy remaps bounds");
      const empty = await save({ selection: { ...selection, filter_text: crypto.randomUUID() } }, journal.revision);
      check((await preview(target.id)).items.length === 0, "catalogue text filter");
      const cleared = await save({ selection: null }, empty.revision);
      check(cleared.source_type_id === null && cleared.last_slot_id === null, "reset selection");
    }
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
