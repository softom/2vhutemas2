import { uniqueBlockIds } from "./blockIds.ts";
function assert(ok: boolean) { if (!ok) throw new Error("Assertion failed"); }
Deno.test("duplicate nested blocks keep content, references and original anchors", () => {
  const input = [{id:"a",content:[{text:"Авторский абзац"}],children:[{id:"a",props:{assetId:"media",targetBlockId:"a"}}]}, {id:"b"}, {id:"a"}];
  const before = JSON.stringify(input);
  const result = uniqueBlockIds(input);
  const ids = [result[0].id, result[0].children![0].id, result[1].id, result[2].id];
  assert(new Set(ids).size === 4);
  assert(result[0].id === "a" && result[1].id === "b");
  assert(JSON.stringify(input) === before);
  assert(JSON.stringify(result[0].content) === JSON.stringify(input[0].content));
  assert(JSON.stringify(result[0].children![0].props) === JSON.stringify(input[0].children![0].props));
  assert(JSON.stringify(uniqueBlockIds(result)) === JSON.stringify(result));
});
Deno.test("unique blocks and blocks without IDs are unchanged", () => {
  type Block = { id?: string; children?: Block[] };
  const input: Block[] = [{id:"a",children:[{id:"b"}]}, {}];
  assert(JSON.stringify(uniqueBlockIds(input)) === JSON.stringify(input));
});
