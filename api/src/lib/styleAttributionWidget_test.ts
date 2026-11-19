import { styleAnalysis } from "./styleAttributionWidget.ts";
import type { PublicCard } from "./publicCard.ts";

Deno.test("style_analysis preserves each citation's own context and attached empty panels", () => {
  const set = { id: "set-1", code: "style_solutions", title: "Стили", side: "left",
    fields: ["concept", "relation", "rationale", "source", "quote", "phase", "zone"].map(slot => ({slot, title: slot})),
    links: [] as unknown[] };
  const render = (sets: unknown[]) => styleAnalysis({relation_sets: sets} as PublicCard);
  if (render([]) || render([{...set, code: "other"}])) throw Error("Unexpected widget");
  if (!render([set]).includes("Опубликованных связей пока нет")) throw Error("Missing empty state");
  set.links.push({id: 1, other_slug: "concept", other_title: "Понятие", role_title: "Отрицание",
    justification: "<обоснование>", citations: [
      {source_title: "Первый", source_slug: "first", phase: "1930", zone: "Фасад", quote: "Цитата А"},
      {source_title: "Второй", source_slug: "second", phase: "1960", quote: "Цитата Б"},
    ]});
  const html = render([set]);
  const rows = html.match(/<li>.*?<\/li>/g) ?? [];
  if (!html.includes("&lt;обоснование&gt;") || !html.includes("Отрицание") ||
      !html.includes('href="/entities/concept"') || rows.length !== 2 ||
      !/first.*Цитата А.*1930.*Фасад/.test(rows[0]) || !/second.*Цитата Б.*1960/.test(rows[1]) ||
      rows[1].includes("Фасад") || rows[1].includes("<dt>zone")) throw Error(html);
});
