import assert from "node:assert/strict";
import { fillSectionPattern } from "../src/lib/sectionPattern.ts";

const slots = ["wide", "upper", "lower"];
const rows = Array.from({length: 10}, (_, i) => i + 1);
const render = (id: number, slot: string) => id === 4 ? "" : id + "/" + slot;
const whole = fillSectionPattern(rows, slots, 0, render);
assert.deepEqual(whole.items.map(item => item.repeat), [0,0,0,1,1,1,2,2,2,3]);
assert.equal(whole.items[3].content, "");
assert.equal(whole.items[4].content, "5/upper");
const first = fillSectionPattern(rows.slice(0, 5), slots, 0, render);
const next = fillSectionPattern(rows.slice(5), slots, first.nextOffset, render);
assert.deepEqual([...first.items, ...next.items].map(item => item.content), whole.items.map(item => item.content));
assert.equal(next.nextOffset, whole.nextOffset);
assert.equal(fillSectionPattern([], slots, 1, render).nextOffset, 1);
assert.throws(() => fillSectionPattern(rows, slots, 3, render), RangeError);
