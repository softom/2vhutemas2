export interface CardSlot {
  id: string;
  renderer_key: string;
  design: string | null;
  row_start: number;
  row_span: number;
  column_start: number;
  column_span: number;
}

/** Rows covered by a spanning slot remain occupied, including its lower rows. */
export function renderCardGrid(
  slots: readonly CardSlot[],
  render: (slot: CardSlot) => string,
  preview: boolean,
): string {
  const visible = slots.map(slot => ({slot, html: render(slot)}))
    .filter(item => preview || item.html);
  if (!visible.length) return "";
  const rows = new Map<number,number>();
  let end = 1;
  let removed = 0;
  for (const {slot} of [...visible].sort((a,b) => a.slot.row_start - b.slot.row_start)) {
    removed += Math.max(0, slot.row_start - end);
    rows.set(slot.row_start, slot.row_start - removed);
    end = Math.max(end, slot.row_start + slot.row_span);
  }
  return '<div class="entity-widget-grid">' + visible.map(({slot,html}) => {
    const row = rows.get(slot.row_start)!;
    // The paper layout has a decorative gutter between logical columns 2 and 3.
    const crossesGutter = slot.column_start < 3 && slot.column_start + slot.column_span > 3;
    const track = slot.column_start === 3 ? 4 : slot.column_start;
    const width = slot.column_span + Number(crossesGutter);
    return `<section class="pc-${slot.renderer_key}" data-crosses-gutter="${crossesGutter}" data-layout-slot="${slot.id}" style="--slot-column:${track};--slot-width:${width};--slot-row:${row};--slot-height:${slot.row_span}">` +
      (html || '<span class="hint">Нет данных</span>') + '</section>';
  }).join("") + '</div>';
}
