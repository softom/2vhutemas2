import { layoutCapabilities } from "./cardSections.ts";
import { type Query, sql } from "./db.ts";
import { widgetImplementations } from "./widgetImplementations.ts";
export { widgetImplementations };

export async function getWidget(id: string, query: Query = sql) {
  const [row] = await query<
    { id: string; name: string; renderer_key: string }
  >`select id,name,renderer_key from app.widgets where id=${id}`;
  const implementation = row && (widgetImplementations.get(row.renderer_key) ?? layoutCapabilities(row.renderer_key));
  return implementation ? { ...row, ...implementation } : null;
}
