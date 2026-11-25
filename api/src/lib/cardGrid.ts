import type { EntityArgument } from "./widgetInstance.ts";

export interface CardSlot {
  display_options?: { title?: string; caption?: string; height?: number };
  call_params?: { entity_id?: EntityArgument };
  id: string;
  renderer_key: string;
  widget_name?: string;
  design: string | null;
  row_start: number;
  row_span: number;
  column_start: number;
  column_span: number;
}

function emptySlot(slot: CardSlot): string {
  const name = (slot.widget_name ?? slot.renderer_key).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const columns = slot.column_span === 1 ? `колонка ${slot.column_start}` :
    `колонки ${slot.column_start}–${slot.column_start + slot.column_span - 1}`;
  return `<span class="hint">${name} · строка ${slot.row_start}, ${columns} — нет данных</span>`;
}

/** Rows covered by a spanning slot remain occupied, including its lower rows. */
export function renderCardGrid(
  slots: readonly CardSlot[],
  render: (slot: CardSlot) => string,
  preview: boolean,
  header?: string,
  columns: 3 | 4 = 3,
): string {
  const visible = slots.map(slot => ({slot, html: render(slot)}))
    .filter(item => preview || item.html);
  if (columns === 3 && header !== undefined && slots.some(s => s.renderer_key === "parameters" && s.column_start === 3 && s.row_start === 1) &&
      slots.every(s => s.row_span === 1 && ((s.column_start === 1 && s.column_span === 2) ||
        (s.renderer_key === "parameters" && s.column_start === 3 && s.row_start === 1)))) {
    const sections = visible.map(({slot, html}, index) => ({
      right: slot.column_start === 3,
      html: `<section class="pc-${slot.renderer_key}" data-layout-slot="${slot.id}" style="--reading-order:${index + 1}">` +
        (html || emptySlot(slot)) + '</section>',
    }));
    return '<div class="card-flows"><div class="card-flow-main">' + header +
      sections.filter(s => !s.right).map(s => s.html).join("") + '</div>' +
      sections.filter(s => s.right).map(s => s.html).join("") + '</div>';
  }
  if (!visible.length) return header ?? "";
  const lanes = [[1, 1], [2, 2], [4, 1]];
  if (columns === 4 && !preview && visible.every(({slot}) =>
    lanes.some(([start, width]) => slot.column_start === start && slot.column_span === width))) {
    const stacks = lanes.map(([start, width]) => {
      const sections = visible.map(({slot, html}, index) => ({slot, html, index}))
        .filter(({slot}) => slot.column_start === start)
        .sort((a, b) => a.slot.row_start - b.slot.row_start)
        .map(({slot, html, index}) =>
          `<section class="pc-${slot.renderer_key}" data-layout-slot="${slot.id}" style="--reading-order:${index + 1}">${html}</section>`
        ).join("");
      return sections ? `<div class="card-lane" style="--slot-column:${start};--slot-width:${width}">${sections}</div>` : "";
    });
    return (header ?? "") + `<div class="entity-widget-grid" data-columns="4" data-card-lanes>${stacks.join("")}</div>`;
  }
  const rows = new Map<number,number>();
  let end = 1;
  let removed = 0;
  for (const {slot} of [...visible].sort((a,b) => a.slot.row_start - b.slot.row_start)) {
    removed += Math.max(0, slot.row_start - end);
    rows.set(slot.row_start, slot.row_start - removed);
    end = Math.max(end, slot.row_start + slot.row_span);
  }
  // A single sidebar beside a vertical stack can span the stack when a panel closes.
  const sidebars = visible.filter(({slot}) => slot.column_start === 3 && slot.column_span === 1);
  const independent = columns === 3 && !preview && sidebars.length === 1 &&
    rows.get(sidebars[0].slot.row_start) === 1 &&
    visible.every(({slot}) => slot.row_span === 1 &&
      (slot === sidebars[0].slot || (slot.column_start === 1 && slot.column_span === 2)));
  const gridSettings = independent ? ` data-sidebar-stack style="--stack-rows:${rows.size}"` : "";
  return (header ?? "") + `<div class="entity-widget-grid" data-columns="${columns}"${gridSettings}>` + visible.map(({slot,html}) => {
    const row = rows.get(slot.row_start)!;
    // The paper layout has a decorative gutter between logical columns 2 and 3.
    const crossesGutter = columns === 3 && slot.column_start < 3 && slot.column_start + slot.column_span > 3;
    const track = columns === 3 && slot.column_start === 3 ? 4 : slot.column_start;
    const width = slot.column_span + Number(crossesGutter);
    return `<section class="pc-${slot.renderer_key}" data-crosses-gutter="${crossesGutter}"${independent && track === 4 ? " data-stack-sidebar" : ""} data-layout-slot="${slot.id}" style="--slot-column:${track};--slot-width:${width};--slot-row:${row};--slot-height:${slot.row_span}">` +
      (html || emptySlot(slot)) + '</section>';
  }).join("") + '</div>';
}
