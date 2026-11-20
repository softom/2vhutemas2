import { widgetRenderers } from "../src/lib/cardWidgets.ts";
import { renderCardGrid } from "../src/lib/cardGrid.ts";
import { modelPages, modelPath } from "../src/lib/modelWidgets.ts";
import { documentBlocks, modelHtml } from "../src/lib/blocksHtml.ts";
import type { PublicCard } from "../src/lib/publicCard.ts";
import assert from "node:assert/strict";

export async function modelPairs() {
  const card = {id: 42, relation_sets: [{id: 1, code: "style_solutions", title: "Стиль",
    fields: [], links: [{id: 2, other_title: "Готика", citations: []}]}]} as unknown as PublicCard;
  const registry = widgetRenderers(card, {});
  const pairs = [];
  for (const key of [...Object.keys(modelPages), "style_analysis"]) {
    const render = registry.get(key)!;
    const slot = {id: key, renderer_key: key, design: "default", column_start: 1, row_start: 1, column_span: 1, row_span: 1};
    const grid = renderCardGrid([slot], s => render(card.id, s.design), false);
    const src = modelPath(key);
    const doc = await documentBlocks([{type: "widget", props: {caption: "Подпись автора"}}],
      {entities: new Map(), publicAssets: new Map()}, async props => src ? modelHtml({...props, src}) : render(card.id));
    for (const html of [grid, doc]) assert.ok(html.includes(src ? src + "?embed=1" : "Готика"), key);
    if (src) assert.ok(doc.includes("Подпись автора"));
    pairs.push('<section data-pair="' + key + '">' + grid + doc + '</section>');
  }
  return pairs.join("");
}

Deno.test("registered models and style analysis render in card slots and document blocks", async () => {
  await modelPairs();
});
