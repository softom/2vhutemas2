import { type Context, Hono } from "hono";
import { require as requirePermission } from "../lib/auth.ts";
import { type Query, sql, transaction } from "../lib/db.ts";
import { ApiError, pgFields } from "../lib/errors.ts";
import type { AppEnv } from "../lib/http.ts";
import { getCardLayout, getPageLayout, readLayout } from "../lib/layouts.ts";
import { getWidget, widgetImplementations } from "../lib/widgetRegistry.ts";

export const layoutAdmin = new Hono<AppEnv>();
layoutAdmin.use("*", async (c, next) => {
  requirePermission(c.get("principal"), "su");
  await next();
});
type Body = Record<string, unknown>;
function invalid(message: string): never {
  throw new ApiError("validation_failed", message);
}
function missing(): never {
  throw new ApiError("not_found", "Объект не найден");
}
function conflict(): never {
  throw new ApiError("version_conflict", "Настройка уже изменилась. Обновите макет.");
}
function uuid(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value)) {
    invalid("Требуется UID");
  }
  return value.toLowerCase();
}
function name(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) invalid("Укажите название");
  return value.trim();
}
function integer(value: unknown): number {
  if (
    typeof value !== "number" || !Number.isInteger(value) || value < -2147483648 ||
    value > 2147483647
  ) invalid("Требуется целое число");
  return value;
}
async function write(c: Context<AppEnv>, action: (q: Query, b: Body) => Promise<unknown>) {
  const b = await c.req.json().catch(() => invalid("Ожидается JSON"));
  if (!b || typeof b !== "object" || Array.isArray(b)) invalid("Ожидается объект");
  try {
    return c.json(await transaction(c.get("principal")!.contributorId, (q) => action(q, b)));
  } catch (error) {
    const { code } = pgFields(error);
    if (code === "23P01") invalid("Слоты пересекаются");
    if (code === "23503" || code === "23514") {
      invalid("Недопустимая ссылка, размер или изменение сохранённой версии");
    }
    throw error;
  }
}
async function lockDraft(q: Query, id: string, expected: unknown) {
  const [layout] = await q<
    { assigned: boolean; revision: number }
  >`select assigned,revision from app.layouts where id=${id} for update`;
  if (!layout) missing();
  if (layout.assigned || layout.revision !== integer(expected)) conflict();
}
layoutAdmin.get(
  "/widgets",
  async (c) => c.json(await sql`select id,name,renderer_key from app.widgets order by name,id`),
);
layoutAdmin.get(
  "/layouts/:id",
  async (c) => c.json(await readLayout(uuid(c.req.param("id"))) ?? missing()),
);
layoutAdmin.get(
  "/pages/:id/layout",
  async (c) => c.json(await getPageLayout(uuid(c.req.param("id")))),
);
layoutAdmin.get(
  "/type_presentations/:id/layout",
  async (c) => c.json(await getCardLayout(uuid(c.req.param("id")))),
);
layoutAdmin.post("/widgets", (c) =>
  write(c, async (q, b) => {
    const key = name(b.renderer_key);
    if (!widgetImplementations.has(key)) invalid("Неизвестная реализация виджета");
    return (await q`insert into app.widgets(name,renderer_key) values(${
      name(b.name)
    },${key}) returning *`)[0];
  }));
layoutAdmin.post(
  "/layouts",
  (c) =>
    write(
      c,
      async (q, b) =>
        (await q`insert into app.layouts(page_id,name) values(${uuid(b.page_id)},${
          name(b.name)
        }) returning *`)[0],
    ),
);
layoutAdmin.post("/layouts/:id/copy", (c) =>
  write(c, async (q, b) => {
    const id = uuid(c.req.param("id"));
    const [source] = await q<
      { page_id: string }
    >`select page_id from app.layouts where id=${id} for share`;
    if (!source) missing();
    const [copy] = await q<
      { id: string }
    >`insert into app.layouts(page_id,name) values(${source.page_id},${name(b.name)}) returning id`;
    await q`insert into app.page_layout(layout_id,widget_id,sort_order,row_start,column_start,row_span,column_span,design)
    select ${copy.id},widget_id,sort_order,row_start,column_start,row_span,column_span,design from app.page_layout where layout_id=${id}`;
    return readLayout(copy.id, q);
  }));
async function saveSlot(q: Query, layout: string, slot: Body) {
  const widget = await getWidget(uuid(slot.widget_id), q);
  if (!widget) invalid("Виджет не зарегистрирован");
  const width = integer(slot.column_span), height = integer(slot.row_span);
  const design = slot.design == null ? null : name(slot.design);
  if (
    !widget.widths.includes(width) || !widget.heights.includes(height) ||
    (design !== null && !widget.designs.includes(design))
  ) invalid("Размер или дизайн не поддерживается");
  const pos = integer(slot.sort_order),
    row = integer(slot.row_start),
    col = integer(slot.column_start);
  if (slot.id !== undefined) {
    const updated =
      await q`update app.page_layout set widget_id=${widget.id},sort_order=${pos},row_start=${row},
      column_start=${col},row_span=${height},column_span=${width},design=${design}
      where id=${uuid(slot.id)} and layout_id=${layout} returning id`;
    if (!updated.length) missing();
  } else {
    await q`insert into app.page_layout(layout_id,widget_id,sort_order,row_start,column_start,row_span,column_span,design)
      values(${layout},${widget.id},${pos},${row},${col},${height},${width},${design})`;
  }
}
layoutAdmin.post("/page_layout", (c) =>
  write(c, async (q, b) => {
    const id = uuid(b.layout_id);
    await lockDraft(q, id, b.expected_revision);
    const slots = b.slots === undefined ? [b] : b.slots;
    if (!Array.isArray(slots) || !slots.length) invalid("Укажите слоты");
    for (const slot of slots) {
      if (!slot || typeof slot !== "object" || Array.isArray(slot)) invalid("Некорректный слот");
      await saveSlot(q, id, slot);
    }
    return readLayout(id, q);
  }));
layoutAdmin.delete("/page_layout/:id", (c) =>
  write(c, async (q, b) => {
    const id = uuid(b.layout_id);
    await lockDraft(q, id, b.expected_revision);
    const deleted = await q`delete from app.page_layout where id=${
      uuid(c.req.param("id"))
    } and layout_id=${id} returning id`;
    if (!deleted.length) missing();
    return readLayout(id, q);
  }));
async function verifyTarget(q: Query, id: string | null, revision: unknown) {
  if (!id) return;
  const [target] = await q<
    { revision: number }
  >`select revision from app.layouts where id=${id} for update`;
  if (!target) missing();
  if (target.revision !== integer(revision)) conflict();
}
function nullableId(value: unknown) {
  return value === null ? null : uuid(value);
}
layoutAdmin.post("/pages/:id/layout", (c) =>
  write(c, async (q, b) => {
    const id = uuid(c.req.param("id")),
      next = nullableId(b.layout_id),
      expected = nullableId(b.expected_layout_id);
    const [page] = await q<
      { current_layout_id: string | null }
    >`select current_layout_id from app.pages where id=${id} for update`;
    if (!page) missing();
    if (page.current_layout_id !== expected) conflict();
    await verifyTarget(q, next, b.expected_revision);
    return (await q`update app.pages set current_layout_id=${next} where id=${id} returning *`)[0];
  }));
layoutAdmin.post("/type_presentations/:typeId/layout", (c) =>
  write(c, async (q, b) => {
    const id = uuid(c.req.param("typeId")),
      next = nullableId(b.layout_id),
      expected = nullableId(b.expected_layout_id);
    await q`select pg_advisory_xact_lock(hashtextextended(${id},0))`;
    const [current] = await q<
      { layout_id: string | null }
    >`select layout_id from app.type_presentations where type_id=${id} and mode='card' for update`;
    if ((current?.layout_id ?? null) !== expected) conflict();
    await verifyTarget(q, next, b.expected_revision);
    if (!current && next === null) {
      if (!(await q`select id from app.entity_types where id=${id}`).length) missing();
      return { layout_id: null };
    }
    return (await q`insert into app.type_presentations(type_id,mode,layout_id,layout_only)
    values(${id},'card',${next},true) on conflict(type_id,mode)
    do update set layout_id=excluded.layout_id returning layout_id`)[0];
  }));
