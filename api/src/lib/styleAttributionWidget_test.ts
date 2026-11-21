import { styleAnalysis } from "./styleAttributionWidget.ts";
import type { PublicCard } from "./publicCard.ts";

Deno.test("style_analysis preserves each citation's own context and attached empty panels", () => {
  const set = {
    id: "set-1",
    code: "style_solutions",
    title: "Стили",
    side: "left",
    fields: ["concept", "relation", "rationale", "source", "quote", "phase", "zone"].map(
      (slot) => ({ slot, title: slot }),
    ),
    links: [] as unknown[],
  };
  const render = (sets: unknown[]) => styleAnalysis({ relation_sets: sets } as PublicCard);
  if (render([]) || render([{ ...set, code: "other" }])) throw Error("Unexpected widget");
  if (!render([set]).includes("Опубликованных связей пока нет")) throw Error("Missing empty state");
  set.links.push({
    id: 1,
    other_slug: "concept",
    other_title: "Понятие",
    role_title: "Отрицание",
    justification: "<обоснование>",
    citations: [
      {
        source_entity_id: 1,
        source_title: "Первый",
        source_slug: "first",
        phase: "1930",
        zone: "Фасад",
        quote: "Цитата А",
      },
      {
        source_entity_id: 2,
        source_title: "Второй",
        source_slug: "second",
        phase: "1960",
        quote: "Цитата Б",
      },
    ],
  });
  const html = render([set]);
  const rows = html.match(/<section><h3><a.*?<\/section>/g) ?? [];
  if (
    !html.includes("&lt;обоснование&gt;") || !html.includes("Отрицание") ||
    !html.includes('href="/entities/concept"') || rows.length !== 2 ||
    !/first.*Цитата А.*1930.*Фасад/.test(rows[0]) || !/second.*Цитата Б.*1960/.test(rows[1]) ||
    rows[1].includes("Фасад") || rows[1].includes("<dt>zone")
  ) throw Error(html);
});

Deno.test("style_analysis takes over the attached panel only for a visible placement", async () => {
  const { cardWidgetSections } = await import("./cardWidgets.ts");
  const card = {
    card_widgets: [{ kind: "style_analysis", cell: "main", after: "links" }],
    relation_sets: [{
      id: "set-1",
      code: "style_solutions",
      title: "Стили",
      links: [],
      fields: [],
    }],
  } as unknown as PublicCard;
  const shown = new Set<string>();
  const sections = cardWidgetSections(card, ["links"], undefined, shown);
  if (!shown.has("style_analysis") || sections.get("links")?.length !== 1) {
    throw Error("Missing placement");
  }
  shown.clear();
  card.card_widgets = [{ kind: "style_analysis", cell: "invalid" }];
  if (cardWidgetSections(card, [], undefined, shown).size || shown.size) {
    throw Error("Invalid placement consumed panel");
  }
});

Deno.test("support counts distinct sources separately by axis, role and context", () => {
  const citation = {
    source_entity_id: 11,
    source_title: "А",
    source_slug: "a",
    phase: "1930",
    zone: "Фасад",
  };
  const first = {
    id: 1,
    other_id: 7,
    other_type_code: "art_styles",
    other_title: "Модерн",
    other_slug: "modern",
    role_id: "membership",
    role_title: "Принадлежность",
    citations: [citation, citation, { ...citation, source_entity_id: 12 }],
  };
  const set = {
    id: "s",
    code: "style_solutions",
    title: "Анализ",
    fields: [],
    links: [
      first,
      { ...first, id: 2, other_id: 8, other_title: "Другое", citations: [citation] },
      { ...first, id: 3, role_id: "negative", role_title: "Отрицание", citations: [citation] },
      { ...first, id: 4, citations: [{ ...citation, zone: "Башня" }] },
    ],
    similar: [{ id: 42, title: "Пример", slug: "example", concepts: [7] }],
  };
  const html = styleAnalysis({ relation_sets: [set] } as unknown as PublicCard);
  for (
    const expected of [
      "66,7%",
      "33,3%",
      "Отрицание · 1930 · Фасад",
      "1930 · Башня",
      "Источников: 2 · связей: 1",
      'href="/entities/example"',
      "Метод формообразования",
    ]
  ) {
    if (!html.includes(expected)) throw Error(expected);
  }
});
