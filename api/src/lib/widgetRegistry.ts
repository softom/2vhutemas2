import { sectionCapabilities } from "./cardSections.ts";
import { type Query, sql } from "./db.ts";
import { styleAnalysis } from "./styleAttributionWidget.ts";

export const widgetImplementations = new Map([["style_analysis", {
  render: styleAnalysis,
  widths: [1, 2, 3],
  heights: [1],
  designs: ["default"],
}]]);

export async function getWidget(id: string, query: Query = sql) {
  const [row] = await query<
    { id: string; name: string; renderer_key: string }
  >`select id,name,renderer_key from app.widgets where id=${id}`;
  const implementation = row && (widgetImplementations.get(row.renderer_key) ?? sectionCapabilities(row.renderer_key));
  return implementation ? { ...row, ...implementation } : null;
}
