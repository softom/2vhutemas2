import assert from "node:assert/strict";
import { blocks, documentBlocks, modelHtml } from "../src/lib/blocksHtml.ts";
import { modelPath } from "../src/lib/modelWidgets.ts";

Deno.test("two insertions of one model retain their own caption, title and height", async () => {
  const ctx = {entities:new Map(),publicAssets:new Map()};
  const src = modelPath("model_grid");
  assert.equal(src, "/models/grid.html");
  assert.equal(modelPath("model_unknown"), null);
  const props = [
    {widget_id:"grid", title:"Первая",caption:"A < B",height:"400"},
    {widget_id:"grid", title:"Вторая",caption:"B > A",height:"700"},
  ];
  const historical = props.map(p => blocks([{type:"modelEmbed",props:{...p,src}}],ctx));
  const html = await documentBlocks(props.map(p => ({type:"widget",props:p})),ctx,p=>Promise.resolve(modelHtml({...p,src})));
  assert.equal(html, historical.map(fragment=>`<div class="document-widget">${fragment}</div>`).join(""));
});
