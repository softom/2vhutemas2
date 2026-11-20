import { styleAnalysis } from "./styleAttributionWidget.ts";

import { styleQuizKey, styleQuizHtml } from "./styleQuizWidget.ts";

export const widgetImplementations = new Map<string, {render: typeof styleAnalysis; widths: number[]; heights: number[]; designs: string[]}>([["style_analysis", {
  render: styleAnalysis,
  widths: [1, 2, 3],
  heights: [1],
  designs: ["default"],
}], [styleQuizKey, { render: styleQuizHtml, widths: [1, 2, 3], heights: [1], designs: ["default"] }]]);
