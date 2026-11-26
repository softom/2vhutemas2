import { modelHtml } from "./blocksHtml.ts";
import { modelPages, modelPath } from "./modelWidgets.ts";
import { widgetImplementations } from "./widgetImplementations.ts";
import type { WidgetRenderer } from "./widgetImplementations.ts";
import type { PublicCard } from "./publicCard.ts";

const additionalRenderers = new Map<string, WidgetRenderer>(
  Array.from(widgetImplementations, ([key, implementation]) => [key, implementation.render]),
);

/** Bind a single authorized card projection once; rendering a slot does not reload the entity. */
export function widgetRenderers(card: Readonly<PublicCard>, sections: Record<string, () => string>) {
  const registry = new Map<string, (entityId: number, design?: string | null) => string>();
  function bind(key: string, draw: (design?: string | null) => string) {
    // Свой вариант макета виджет объявляет сам (designs); чужие отсекаются.
    const designs = widgetImplementations.get(key)?.designs ?? ["default"];
    registry.set(key, (entityId, design) => {
      if (entityId !== card.id) return "";
      if (!designs.includes(design ?? "default")) return "";
      return draw(design);
    });
  }
  for (const [key, draw] of Object.entries(sections)) bind(key, () => draw());
  for (const [key, render] of additionalRenderers) bind(key, (design) => render(card, design));
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
    const { kind, cell, after, design } = item;
    if (!["main", "side", "full"].includes(cell) || seen.has(kind)) continue;
    if (after !== undefined && typeof after !== "string") continue;
    if (design !== undefined && design !== null && typeof design !== "string") continue;
    const render = renderers.get(kind);
    if (!render) continue;
    seen.add(kind);
    const html = render(card, design ?? null);
    if (!html) continue;
    renderedKinds?.add(kind);
    const anchor = layout.includes(after) ? after : "";
    const group = groups.get(anchor) ?? [];
    group.push(`<section class="pc-widget" data-cell="${cell}">${html}</section>`);
    groups.set(anchor, group);
  }
  return groups;
}
