import { modelHtml } from "./blocksHtml.ts";
import { modelPages, modelPath } from "./modelWidgets.ts";
import { widgetImplementations } from "./widgetImplementations.ts";
import type { PublicCard } from "./publicCard.ts";

type Renderer = (card: Readonly<PublicCard>) => string;
const additionalRenderers = new Map<string, Renderer>(
  Array.from(widgetImplementations, ([key, implementation]) => [key, implementation.render]),
);

/** Bind a single authorized card projection once; rendering a slot does not reload the entity. */
export function widgetRenderers(card: Readonly<PublicCard>, sections: Record<string, () => string>) {
  const registry = new Map<string, (entityId: number, design?: string | null) => string>();
  function bind(key: string, draw: () => string) {
    registry.set(key, (entityId, design) =>
      entityId === card.id && (!design || design === "default") ? draw() : "");
  }
  for (const [key, draw] of Object.entries(sections)) bind(key, draw);
  for (const [key, render] of additionalRenderers) bind(key, () => render(card));
  for (const [key, title] of Object.entries(modelPages)) {
    bind(key, () => modelHtml({src: modelPath(key), title}));
  }
  return registry;
}

/** Group visible widgets by insertion point in the existing reading order. */
export function cardWidgetSections(
  card: PublicCard,
  layout: readonly string[],
  renderers = additionalRenderers,
  renderedKinds?: Set<string>,
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
    renderedKinds?.add(kind);
    const anchor = layout.includes(after) ? after : "";
    const group = groups.get(anchor) ?? [];
    group.push(`<section class="pc-widget" data-cell="${cell}">${html}</section>`);
    groups.set(anchor, group);
  }
  return groups;
}
