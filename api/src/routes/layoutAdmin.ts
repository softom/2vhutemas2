import { entities } from "./entities.ts";
import { expandSelection } from "../lib/sectionPattern.ts";
import { instanceContract, instanceOverrides } from "../lib/widgetInstance.ts";
import { sectionCapabilities } from "../lib/cardSections.ts";
import { type Context, Hono } from "hono";
import { require as requirePermission } from "../lib/auth.ts";
import { type Query, sql, transaction } from "../lib/db.ts";
import { ApiError, pgFields } from "../lib/errors.ts";
import type { AppEnv } from "../lib/http.ts";
import { CARD_PAGE_ID, getCardLayout, getPageLayout, readLayout } from "../lib/layouts.ts";
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
  async (c) => {
    const rows = await sql<{ id: string; name: string; renderer_key: string }>`select id,name,renderer_key from app.widgets order by name,id`;
    return c.json(rows.map(row => {
      const spec = widgetImplementations.get(row.renderer_key) ?? sectionCapabilities(row.renderer_key);
      return { ...row, instance: spec ? instanceContract(row.renderer_key, spec.designs) : null };
    }));
  },
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
// Preview reads the same public catalogue as the site, including publication and archive rules.
layoutAdmin.get("/layouts/:id/selection-preview", async (c) => {
  const layout = await readLayout(uuid(c.req.param("id"))) ?? missing();
  if (!layout.repeat_mode || !layout.first_slot_id || !layout.last_slot_id) invalid("Выборка не настроена");
  const [type] = await sql<{ code: string }>`with recursive branch(id) as (
    select ${layout.source_type_id}::uuid union select t.id from app.entity_types t join branch b on t.parent_id=b.id
  ) select t.code from app.entity_types t join branch b on b.id=t.id where t.id=${layout.filter_type_id ?? layout.source_type_id}`;
  if (!type) invalid("Тип фильтра вне источника");
  const params = new URLSearchParams({ type: type.code, limit: "4" });
  if (layout.page_id === "39ee9267-1a0e-4928-b608-24bf91f68102") params.set("scope", "objects");
  if (layout.filter_text) params.set("q", layout.filter_text);
  const response = await entities.request("/?" + params);
  if (!response.ok) throw new Error("Ошибка чтения каталога");
  const { items } = await response.json() as { items: { id: string | number }[] };
  const pattern = expandSelection(items, layout.slots, layout.first_slot_id, layout.last_slot_id, layout.repeat_mode);
  return c.json({ items: pattern.items.map(({ slot, content, repeat }) => ({
    slot_id: slot.id, entity_id: String(content.id), repeat,
  })) });
});
layoutAdmin.post("/widgets", (c) =>
  write(c, async (q, b) => {
    const key = name(b.renderer_key);
    if (!widgetImplementations.has(key) && !sectionCapabilities(key)) invalid("Неизвестная реализация виджета");
    return (await q`insert into app.widgets(name,renderer_key) values(${
      name(b.name)
    },${key}) returning *`)[0];
  }));
layoutAdmin.post("/layouts", (c) =>
  write(c, async (q, b) => {
    const columns = b.grid_columns === undefined ? 3 : integer(b.grid_columns);
    if (columns !== 3 && columns !== 4) invalid("Макет поддерживает три или четыре колонки");
    return (await q`insert into app.layouts(page_id,name,grid_columns)
      values(${uuid(b.page_id)},${name(b.name)},${columns}) returning *`)[0];
  }));
layoutAdmin.post("/layouts/:id/copy", (c) =>
  write(c, async (q, b) => {
    const id = uuid(c.req.param("id"));
    const [source] = await q<
      { page_id: string; grid_columns: number }
    >`select page_id,grid_columns from app.layouts where id=${id} for share`;
    if (!source) missing();
    const [copy] = await q<
      { id: string }
    >`insert into app.layouts(page_id,name,grid_columns) values(${source.page_id},${name(b.name)},${source.grid_columns}) returning id`;
    await q`insert into app.page_layout(layout_id,widget_id,sort_order,row_start,column_start,row_span,column_span,design,display_options,call_params)
    select ${copy.id},widget_id,sort_order,row_start,column_start,row_span,column_span,design,display_options,call_params from app.page_layout where layout_id=${id}`;
    await q`update app.layouts dest set source_type_id=src.source_type_id,filter_type_id=src.filter_type_id,
      filter_text=src.filter_text,repeat_mode=src.repeat_mode,first_slot_id=ca.id,last_slot_id=cb.id
      from app.layouts src join app.page_layout a on a.id=src.first_slot_id join app.page_layout b on b.id=src.last_slot_id
      join app.page_layout ca on ca.layout_id=${copy.id} and ca.sort_order=a.sort_order
      join app.page_layout cb on cb.layout_id=${copy.id} and cb.sort_order=b.sort_order
      where src.id=${id} and dest.id=${copy.id}`;
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
  const contract = instanceContract(widget.renderer_key, widget.designs);
  const display = instanceOverrides(slot.display_options, contract.display_options);
  const params = instanceOverrides(slot.call_params, contract.call_params);
  const pos = integer(slot.sort_order),
    row = integer(slot.row_start),
    col = integer(slot.column_start);
  if (slot.id !== undefined) {
    const updated =
      await q`update app.page_layout set widget_id=${widget.id},sort_order=${pos},row_start=${row},
      column_start=${col},row_span=${height},column_span=${width},
      design=case when ${slot.design === undefined} and widget_id=${widget.id} then design else ${design} end,
      display_options=coalesce(${display}::jsonb,case when widget_id=${widget.id} then display_options else '{}'::jsonb end),
      call_params=coalesce(${params}::jsonb,case when widget_id=${widget.id} then call_params else '{}'::jsonb end)
      where id=${uuid(slot.id)} and layout_id=${layout} returning id`;
    if (!updated.length) missing();
  } else {
    await q`insert into app.page_layout(layout_id,widget_id,sort_order,row_start,column_start,row_span,column_span,design,display_options,call_params)
      values(${layout},${widget.id},${pos},${row},${col},${height},${width},${design},coalesce(${display}::jsonb,'{}'),coalesce(${params}::jsonb,'{}'))`;
  }
}
async function saveSelection(q: Query, id: string, value: unknown) {
  if (value === null) {
    await q`update app.layouts set source_type_id=null,filter_type_id=null,filter_text=null,
      repeat_mode=null,first_slot_id=null,last_slot_id=null where id=${id}`;
    return;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("Укажите параметры выборки");
  const selection = value as Body;
  const keys = ["source_type_id","filter_type_id","filter_text","repeat_mode","first_slot_id","last_slot_id"];
  if (Object.keys(selection).some(key => !keys.includes(key))) invalid("Неизвестное поле выборки");
  if (selection.repeat_mode !== "block" && selection.repeat_mode !== "journal") invalid("Укажите режим повтора");
  if (selection.filter_text != null && typeof selection.filter_text !== "string") invalid("Ожидается текст фильтра");
  await q`update app.layouts set source_type_id=${uuid(selection.source_type_id)},
    filter_type_id=${selection.filter_type_id == null ? null : uuid(selection.filter_type_id)},
    filter_text=${selection.filter_text?.trim() || null},repeat_mode=${selection.repeat_mode},
    first_slot_id=${uuid(selection.first_slot_id)},last_slot_id=${uuid(selection.last_slot_id)} where id=${id}`;
}
layoutAdmin.post("/page_layout", (c) =>
  write(c, async (q, b) => {
    const id = uuid(b.layout_id);
    await lockDraft(q, id, b.expected_revision);
    const slots = b.slots === undefined ? (b.widget_id !== undefined || b.selection === undefined ? [b] : []) : b.slots;
    if (!Array.isArray(slots) || (!slots.length && b.selection === undefined)) invalid("Укажите слоты");
    for (const slot of slots) {
      if (!slot || typeof slot !== "object" || Array.isArray(slot)) invalid("Некорректный слот");
      await saveSlot(q, id, slot);
    }
    if (b.selection !== undefined) await saveSelection(q, id, b.selection);
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

layoutAdmin.get("/card-layout-editor", async c => {
  const [pages,types,layouts,widgets] = await Promise.all([
    sql`select current_layout_id from app.pages where id=${CARD_PAGE_ID}`,
    sql`select t.id,t.title_ru as name,p.layout_id from app.entity_types t
      left join app.type_presentations p on p.type_id=t.id and p.mode='card' order by t.title_ru,t.id`,
    sql`select id,name from app.layouts where page_id=${CARD_PAGE_ID} order by name,id`,
    sql`select id,name from app.widgets order by name,id`,
  ]);
  return c.json({page_id:CARD_PAGE_ID,current_layout_id:pages[0]?.current_layout_id,types,layouts,widgets});
});
