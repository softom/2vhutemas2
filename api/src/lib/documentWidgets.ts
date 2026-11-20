import type { Tx } from "./db.ts";
import { ApiError } from "./errors.ts";
import { modelPath } from "./modelWidgets.ts";
import { sectionCapabilities } from "./cardSections.ts";
import { widgetImplementations } from "./widgetRegistry.ts";

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function invalid(message: string): never {
  throw new ApiError("validation_failed", message);
}

/** Working copies can refer to drafts. Publication checks the selected snapshot. */
export async function validateDocumentWidgets(tx: Tx, body: unknown, publicTargetsOnly = false, ownerId?: number) {
  const definitions = new Map<string, Set<string>>();
  const targets = new Set<number>();
  const modelFields = new Set<string>();
  const withTarget = new Set<string>();
  function visit(list: unknown) {
    if (!Array.isArray(list)) return;
    for (const block of list) {
      if (block?.type === "widget") {
        const {widget_id, entity_id, design} = block.props ?? {};
        if (typeof widget_id !== "string" || !uuid.test(widget_id)) invalid("Некорректный UID виджета");
        const id = widget_id.toLowerCase();
        for (const field of ["title", "caption", "height"]) {
          const value = block.props[field];
          if (value == null || value === "") continue;
          if (typeof value !== "string") invalid("Некорректное свойство вставки модели");
          if (field === "height" && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))) {
            invalid("Высота модели должна быть целым числом");
          }
          modelFields.add(id);
        }
        const designs = definitions.get(id) ?? new Set<string>();
        if (design != null && design !== "") {
          if (typeof design !== "string") invalid("Некорректное оформление виджета");
          designs.add(design);
        }
        definitions.set(id, designs);
        if (entity_id != null && entity_id !== "") {
          if ((typeof entity_id !== "number" && typeof entity_id !== "string") ||
              !/^[1-9]\d*$/.test(String(entity_id)) || !Number.isSafeInteger(Number(entity_id))) {
            invalid("Некорректный UID записи виджета");
          }
          withTarget.add(id);
          targets.add(Number(entity_id));
        }
      }
      visit(block?.children);
    }
  }
  visit(body);
  if (!definitions.size) return;
  const rows = await tx<{id: string; renderer_key: string}>`select id,renderer_key from app.widgets
    where id=any(${[...definitions.keys()]}::uuid[])`;
  if (rows.length !== definitions.size) invalid("Виджет отсутствует в каталоге");
  for (const row of rows) {
    if (modelPath(row.renderer_key) ? withTarget.has(row.id) : modelFields.has(row.id)) invalid("Свойства вставки несовместимы с виджетом");
    const spec = widgetImplementations.get(row.renderer_key) ?? sectionCapabilities(row.renderer_key);
    if (!spec) invalid("Реализация виджета недоступна");
    for (const design of definitions.get(row.id)!) {
      if (!spec.designs.includes(design)) invalid("Оформление не поддерживается виджетом");
    }
  }
  if (!targets.size) return;
  const available = await tx`select id from app.entities where id=any(${[...targets]}::bigint[])
    and status <> 'archived' and (not ${publicTargetsOnly} or is_published or id=${ownerId ?? null}::bigint)
    order by id for share`;
  if (available.length !== targets.size) invalid("Запись виджета не найдена или недоступна");
}

export async function validatePublishedWidgets(tx: Tx, revision: string) {
  const [row] = await tx`select snapshot->'body_json' as body, entity_id from app.revisions where id=${revision}`;
  if (row) await validateDocumentWidgets(tx, row.body, true, row.entity_id == null ? undefined : Number(row.entity_id));
}
