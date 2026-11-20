import { renderCardGrid } from "../../api/src/lib/cardGrid";
import { documentBlocks } from "../../api/src/lib/blocksHtml";
import { styleQuizHtml, styleQuizKey } from "../../api/src/lib/styleQuizWidget";
import { observeWidgets } from "../src/clientWidgets";
import { clientWidgets } from "../src/clientWidgetRegistry";

export async function mountPair(uid: string) {
  const grid = renderCardGrid([{id:"slot", renderer_key:styleQuizKey, design:"default",
    column_start:1, column_span:2, row_start:1, row_span:1}], styleQuizHtml, false);
  const text = await documentBlocks([{type:"widget", props:{widget_id:uid}}],
    {entities:new Map(), publicAssets:new Map()}, async props => props.widget_id === uid ? styleQuizHtml() : "");
  document.body.innerHTML = grid + text;
  return observeWidgets(document.body, clientWidgets);
}
