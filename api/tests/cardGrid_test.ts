import assert from "node:assert/strict";
import { type CardSlot, renderCardGrid } from "../src/lib/cardGrid.ts";
const slots: CardSlot[] = [
  {id:"wide",renderer_key:"test",design:null,row_start:3,row_span:2,column_start:1,column_span:2},
  {id:"empty",renderer_key:"test",design:null,row_start:5,row_span:1,column_start:3,column_span:1},
  {id:"last",renderer_key:"test",design:null,row_start:9,row_span:1,column_start:3,column_span:1},
];
for (const preview of [false,true]) {
  const calls: string[] = [];
  const html = renderCardGrid(slots, slot => {calls.push(slot.id);return slot.id==="empty"?"":slot.id;},preview);
  assert.deepEqual(calls,["wide","empty","last"]);
  assert.equal((html.match(/data-layout-slot=/g)??[]).length,preview?3:2);
  assert.ok(html.includes('--slot-row:1;--slot-height:2'));
  assert.ok(html.includes(`--slot-row:${preview?4:3};--slot-height:1`));
  assert.equal(html.includes("Нет данных"),preview);
}
assert.equal(slots[2].row_start,9);
