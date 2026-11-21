import "../src/lib/json.ts";
import { Hono } from "hono";
import { pages } from "../src/routes/pages.ts";
import { entities } from "../src/routes/entities.ts";
import { layoutAdmin } from "../src/routes/layoutAdmin.ts";
import { closePool, sql } from "../src/lib/db.ts";
import { type AppEnv, handleError } from "../src/lib/http.ts";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

Deno.test("section pages filter visible records before resolving widget targets", async () => {
  check(
    Deno.env.get("APP_API_DB_NAME")?.startsWith("widget_0065_integration_"),
    "Dedicated test database required",
  );
  const app = new Hono<AppEnv>();
  app.onError(handleError);
  try {
    const [author] = await sql<{ id: string }>`select id from app.contributors limit 1`;
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
    app.route("/entities", entities);
    async function admin(path: string, body: unknown) {
      const response = await app.request("/admin" + path, {
        method: "POST",
        headers: { "test-role": "su", "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      check(response.ok, await response.clone().text());
      return response.json();
    }
    if (!(await sql`select 1 from app.widgets where renderer_key='record_compact'`).length) {
      await admin("/widgets", { name: "Компактная запись", renderer_key: "record_compact" });
    }
    const widgets = await sql<
      { id: string; renderer_key: string }
    >`select id,renderer_key from app.widgets where renderer_key in ('record_compact','citation') order by renderer_key desc`;
    for (
      const [section, root, type, pageId] of [
        ["objects", "what", "architecture_object", "39ee9267-1a0e-4928-b608-24bf91f68102"],
        ["authors", "who", "person", "39ee9267-1a0e-4928-b608-24bf91f68103"],
      ]
    ) {
      const [types] = await sql<
        { source: string; filter: string }
      >`select r.id as source,t.id as filter from app.entity_types r, app.entity_types t where r.code=${root} and t.code=${type}`;
      const [old] = await sql<
        { current_layout_id: string | null }
      >`select current_layout_id from app.pages where id=${pageId}`;
      check(!old.current_layout_id, "Test expects unassigned section");
      const [hidden] = await sql<
        { id: string; title_ru: string }
      >`select id::text,title_ru from app.entities where type_id=${types.filter} and not is_published and status<>'archived' and title_ru ilike '%а%' order by id limit 1`;
      check(hidden, "Fixture requires one draft");
      for (const mode of ["block", "journal"]) {
        const layout = await admin("/layouts", {
          page_id: pageId,
          name: "3.2 " + section + " " + mode,
          grid_columns: 4,
        });
        const slots = await admin("/page_layout", {
          layout_id: layout.id,
          expected_revision: 0,
          slots: widgets.map((w, i) => ({
            widget_id: w.id,
            sort_order: i + 1,
            row_start: 1,
            row_span: 1,
            column_start: 2 * i + 1,
            column_span: 2,
          })),
        });
        const ready = await admin("/page_layout", {
          layout_id: layout.id,
          expected_revision: slots.revision,
          slots: slots.slots.map((s: Record<string, unknown>) => ({
            ...s,
            call_params: { entity_id: { alias: ".this" } },
          })),
          selection: {
            source_type_id: types.source,
            filter_type_id: types.filter,
            filter_text: "а",
            repeat_mode: mode,
            first_slot_id: slots.slots[0].id,
            last_slot_id: slots.slots[1].id,
          },
        });
        const assign = "/pages/" + pageId + "/layout";
        await admin(assign, {
          layout_id: layout.id,
          expected_layout_id: null,
          expected_revision: ready.revision,
        });
        try {
          const query = new URLSearchParams({ section, limit: "4", type: root });
          const get = async (p: URLSearchParams, editor = false) => {
            const r = await app.request("/entities?" + p, {
              headers: editor ? { "test-role": "editor" } : {},
            });
            check(r.ok, await r.clone().text());
            return (await r.json()).items;
          };
          const rows = await get(query);
          check(rows.length === 4, "Four public records expected");
          const expected: string[] = [];
          for (const [i, row] of rows.entries()) {
            check(
              row.is_published && row.type === type && /а/i.test(row.title_ru + " " + row.title_en),
              "Stored filter and visibility",
            );
            const cells = row.section_output.cells;
            check(cells.length === (mode === "block" ? 2 : 1), "Rendered slot count");
            for (const [j, cell] of cells.entries()) {
              check(
                cell.entity_id === String(row.id) &&
                  cell.slot_id === slots.slots[mode === "block" ? j : i % 2].id,
                "Wrong widget context",
              );
              check(cell.html.includes(row.slug), "Renderer did not use resolved entity");
              expected.push(cell.entity_id);
            }
          }
          const response = await pages.request("/" + section + "?limit=4");
          const html = await response.text();
          const actual = [...html.matchAll(/data-section-slot="[^"]+" data-entity-id="(\d+)"/g)]
            .map((found) => found[1]);
          check(response.ok && actual.join() === expected.join(), "SSR and client API disagree");
          query.set("q", hidden.title_ru);
          const guest = await get(query), editor = await get(query, true);
          check(
            !guest.some((r: { id: number }) => String(r.id) === hidden.id) &&
              editor.some((r: { id: number }) => String(r.id) === hidden.id),
            "Draft permissions",
          );
          query.delete("q");
          query.set("type", section === "authors" ? "what" : "who");
          check(!(await get(query, true)).length, "Visitor filter broadened the section");
          console.log(
            section,
            mode,
            "public calls",
            actual.join(","),
            "draft visible only to editor",
            hidden.id,
          );
        } finally {
          await admin(assign, { layout_id: null, expected_layout_id: layout.id });
        }
      }
    }
  } finally {
    await closePool();
  }
});
