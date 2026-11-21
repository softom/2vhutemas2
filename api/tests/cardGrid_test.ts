import assert from "node:assert/strict";
import { type CardSlot, renderCardGrid } from "../src/lib/cardGrid.ts";
const slots: CardSlot[] = [
  {id:"wide",renderer_key:"test",design:null,row_start:3,row_span:2,column_start:1,column_span:2},
  {id:"empty",widget_name:"Галерея <1>",renderer_key:"test",design:null,row_start:5,row_span:1,column_start:3,column_span:1},
  {id:"last",renderer_key:"test",design:null,row_start:9,row_span:1,column_start:3,column_span:1},
];
for (const preview of [false,true]) {
  const calls: string[] = [];
  const html = renderCardGrid(slots, slot => {calls.push(slot.id);return slot.id==="empty"?"":slot.id;},preview);
  assert.deepEqual(calls,["wide","empty","last"]);
  assert.equal((html.match(/data-layout-slot=/g)??[]).length,preview?3:2);
  assert.ok(html.includes('--slot-row:1;--slot-height:2'));
  assert.ok(html.includes(`--slot-row:${preview?4:3};--slot-height:1`));
  assert.equal(html.includes("Галерея &lt;1&gt; · строка 5, колонка 3 — нет данных"),preview);
}
assert.equal(slots[2].row_start,9);

const librarySlots = ["parameters", "parameters", "links", "text", "gallery", "drawings", "sources", "mentions", "citation"].map((key, i) => ({
  id: String(i), renderer_key: key, widget_name: i < 2 ? "Параметры" : key, design: null,
  row_start: Math.max(1, i), row_span: 1, column_start: i === 1 ? 3 : 1, column_span: i === 1 ? 1 : 2,
}));
for (const preview of [false, true]) {
  const html = renderCardGrid(librarySlots, s => ["links", "text", "citation"].includes(s.renderer_key) ? s.renderer_key : "", preview, "<h1>Библиотека Александрина</h1>");
  assert.equal((html.match(/data-layout-slot=/g) ?? []).length, preview ? 9 : 3);
  assert.equal((html.match(/— нет данных/g) ?? []).length, preview ? 6 : 0);
  assert.equal(html.includes("Параметры · строка 1, колонки 1–2"), preview);
  assert.equal(html.includes("Параметры · строка 1, колонка 3"), preview);
}

Deno.test("four columns use logical tracks and retain the slot reading order", () => {
  const pilot = [1, 2, 4].map((column, index) => ({
    id: String(index), renderer_key: "citation", design: null, row_start: 2,
    row_span: 1, column_start: column, column_span: index === 1 ? 2 : 1,
  }));
  const html = renderCardGrid(pilot, slot => slot.id, false, "<h1>Карточка</h1>", 4);
  assert.ok(html.includes('data-columns="4"'));
  assert.deepEqual([...html.matchAll(/--slot-column:(\d+);--slot-width:(\d+)/g)].map(m => [m[1], m[2]]),
    [["1", "1"], ["2", "2"], ["4", "1"]]);
  assert.ok(!html.includes('data-crosses-gutter="true"'));
});
