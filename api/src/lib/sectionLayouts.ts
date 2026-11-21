import { isPageFrame } from "./cardSections.ts";
import { config } from "./config.ts";
import { getPageLayout, type CardLayout } from "./layouts.ts";
import { fillSectionPattern } from "./sectionPattern.ts";

export const sectionPages = {
  "/objects": { id: "39ee9267-1a0e-4928-b608-24bf91f68102", widget: "record_compact", title: "Компактная запись" },
  "/authors": { id: "39ee9267-1a0e-4928-b608-24bf91f68103", widget: "record_compact", title: "Компактная запись" },
  "/news": { id: "39ee9267-1a0e-4928-b608-24bf91f68105", widget: "news_compact", title: "Компактная новость" },
} as const;

export async function sectionLayout(path: keyof typeof sectionPages) {
  const layout = config.useWidgetLayouts ? await getPageLayout(sectionPages[path].id) : null;
  if (!layout) return null;
  return { ...layout, frame: layout.slots.filter(s => isPageFrame(s.renderer_key)),
    slots: layout.repeat_mode ? layout.slots : layout.slots.filter(s => !isPageFrame(s.renderer_key)) };
}

export function sectionCells<T>(layout: CardLayout, rows: T[], offset: number, key: string,
  render: (row: T, index: number) => string) {
  if (!layout.slots.length) return "";
  const height = Math.max(...layout.slots.map(s => s.row_start + s.row_span - 1));
  const pattern = fillSectionPattern(rows, layout.slots, offset, row => row);
  return pattern.items.map(({content, slot, repeat}, index) => {
    if (slot.renderer_key !== key) return "";
    const html = render(content, index);
    if (!html) return "";
    const style = `grid-column:${slot.column_start}/span ${slot.column_span};grid-row:${repeat * height + slot.row_start}/span ${slot.row_span}`;
    return `<div data-section-slot="${slot.id}" style="${style}">${html}</div>`;
  }).join("");
}
