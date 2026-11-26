import { styleAnalysis } from "./styleAttributionWidget.ts";

import { styleQuizKey, styleQuizHtml } from "./styleQuizWidget.ts";
import type { PublicCard } from "./publicCard.ts";

/**
 * Рендер виджета: карточка и вариант макета (`design`).
 * `design` приходит из слота макета: «default» — компактный режим,
 * «expanded» — раскрытый (Р6).
 */
export type WidgetRenderer = (card: Readonly<PublicCard>, design?: string | null) => string;

export const widgetImplementations = new Map<string, {render: WidgetRenderer; widths: number[]; heights: number[]; designs: string[]}>([["style_analysis", {
  render: styleAnalysis,
  widths: [1, 2, 3],
  heights: [1],
  designs: ["default", "expanded"],
}], [styleQuizKey, { render: styleQuizHtml, widths: [1, 2, 3], heights: [1], designs: ["default"] }]]);
