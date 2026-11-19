import type { PublicCard } from "./publicCard.ts";

type Renderer = (card: Readonly<PublicCard>) => string;
export const cardWidgetRenderers = new Map<string, Renderer>();

/** Group visible widgets by insertion point in the existing reading order. */
export function cardWidgetSections(
  card: PublicCard,
  layout: readonly string[],
  renderers = cardWidgetRenderers,
): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  const seen = new Set<string>();
  if (!Array.isArray(card.card_widgets)) return groups;
  for (const item of card.card_widgets) {
    if (!item || typeof item !== "object") continue;
    const { kind, cell, after } = item;
    if (!["main", "side", "full"].includes(cell) || seen.has(kind)) continue;
    if (after !== undefined && typeof after !== "string") continue;
    const render = renderers.get(kind);
    if (!render) continue;
    seen.add(kind);
    const html = render(card);
    if (!html) continue;
    const anchor = layout.includes(after) ? after : "";
    const group = groups.get(anchor) ?? [];
    group.push(`<section class="pc-widget" data-cell="${cell}">${html}</section>`);
    groups.set(anchor, group);
  }
  return groups;
}
