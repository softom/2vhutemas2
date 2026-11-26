import { styleAnalysis } from "./styleAttributionWidget.ts";
import { conceptIconPaths } from "./conceptIcons.ts";
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
      "Принадлежность — Модерн",
      'href="/entities/example"',
      "Метод формообразования",
    ]
  ) {
    if (!html.includes(expected)) throw Error(expected);
  }
});

Deno.test("default scores precede labelled groups on all four axes", () => {
  for (const [axis, role] of [
    ["art_epochs", "classification_membership"], ["art_styles", "classification_membership"],
    ["form_method", "classification_trait"], ["morphological_trait", "classification_trait"],
  ]) {
    const link = {id: 1, other_id: 2, other_type_code: axis, other_title: "Общее", other_slug: "common",
      role, role_id: role, role_title: "Обычная роль", citations: [{source_entity_id: 3, source_slug: "s", source_title: "Источник", phase: "", zone: ""}]};
    const links = [
      {...link, role: "classification_citation", role_id: "citation", role_title: "Цитирование приёма"},
      {...link, role: "classification_negation", role_id: "negation", role_title: "Отрицание атрибуции"},
      {...link, citations: [{...link.citations[0], zone: "фасад"}]},
      {...link, citations: [{...link.citations[0], phase: "1923"}]}, link,
    ];
    const html = styleAnalysis({relation_sets:[{id:"s",code:"style_solutions",title:"Стили",fields:[],links}]} as unknown as PublicCard);
    const section = html.split(`data-axis="${axis}">`)[1].split("</section>")[0];
    if (!section.includes('</h3><div class="style-score"') || section.includes('<h4>Обычная роль</h4>')) throw Error(axis);
    for (const title of ["Цитирование приёма","Обычная роль · фасад","Обычная роль · 1923"]) {
      if (!section.includes(`<h4>${title}</h4>`)) throw Error(title);
    }
  }
});

Deno.test("five plus one positive votes and objections from repeated citations", () => {
  const link = (id: number, role: string, ids: number[]) => ({
    id, role, role_id: role, other_type_code: "art_styles", other_id: id, other_slug: "c"+id,
    other_title: "Понятие "+id, citations: ids.map(source_entity_id => ({source_entity_id})),
  });
  const set = {code:"style_solutions", fields:[], links:[
    link(1,"classification_membership",[1,2,3,4,5]), link(2,"classification_membership",[6]),
    link(2,"classification_negation",[7,7]), link(3,"classification_negation",[8])
  ]};
  const html = styleAnalysis({relation_sets:[set]} as unknown as PublicCard).split('data-axis="art_styles">')[1].split("</section>")[0];
  if (!html.includes("За: 1 ист. (16,7%)") || !html.includes("83,3%") ||
      (html.match(/href="\/entities\/c2"/g)??[]).length!==1 ||
      (html.match(/Оспаривается: 1 ист\./g)??[]).length!==2 ||
      /<meter|%/.test(html.split('class="style-counterbar style-negative"')[1])) throw Error(html);
});

Deno.test("concept icon rides with the concept and takes its colour from data", () => {
  const render = (extra: Record<string, unknown>) =>
    styleAnalysis({
      relation_sets: [{
        id: "s", code: "style_solutions", title: "Стили", fields: [],
        links: [{
          id: 1, other_id: 7, other_type_code: "art_styles", other_title: "Модерн", other_slug: "modern",
          role: "classification_membership", role_id: "membership", role_title: "Принадлежность",
          citations: [{ source_entity_id: 1, source_slug: "s", source_title: "Источник" }],
          ...extra,
        }],
      }],
    } as unknown as PublicCard);

  const own = render({ concept_icon: "style_historicism", concept_color: "#A9381F" });
  if (!own.includes('<span class="style-concept" style="--concept-color:#A9381F">')) throw Error("нет цвета из данных");
  if (!own.includes(conceptIconPaths("style_historicism"))) throw Error("нет своего знака");
  if (!own.includes('<svg class="concept-icon"') || !own.includes('stroke="currentColor"')) throw Error("нет инлайнового знака");
  if (!/<a href="\/entities\/modern"><span class="style-concept"/.test(own)) throw Error("знак не в ссылке");
  if (own.includes("<script")) throw Error("в разметке появился скрипт");

  // Своего знака нет — знак своей оси (Р2.6), цвет понятия при этом остаётся.
  const noIcon = render({ concept_color: "#123456" });
  if (!noIcon.includes(conceptIconPaths("axis_styles"))) throw Error("нет запасного знака оси");
  if (noIcon.includes(conceptIconPaths("style_historicism"))) throw Error("чужой знак вместо запасного");
  if (!noIcon.includes("--concept-color:#123456")) throw Error("потерян цвет понятия");

  // Ключ не из набора — тоже запасной знак оси (Р11, Р12).
  const unknown = render({ concept_icon: "no_such_icon" });
  if (!unknown.includes(conceptIconPaths("axis_styles"))) throw Error("нет запасного знака для чужого ключа");
  if (unknown.includes("--concept-color")) throw Error("цвет без данных");

  // Цвет не HEX — цвет оси, значение из данных не подставляется (Р25).
  const badColor = render({ concept_icon: "style_historicism", concept_color: "red; background:url(x)" });
  if (badColor.includes("--concept-color")) throw Error("чужое значение попало в разметку");
  if (!badColor.includes(conceptIconPaths("style_historicism"))) throw Error("потерян знак");

  // Связь не с понятием классификации (например, изображение) — знака нет.
  const other = render({ other_type_code: "image", concept_icon: "style_historicism", concept_color: "#A9381F" });
  if (other.includes("concept-icon")) throw Error("знак у связи не с понятием");
});

Deno.test("concept icon shows in sources and similar objects", () => {
  const link = {
    id: 1, other_id: 7, other_type_code: "art_styles", other_title: "Модерн", other_slug: "modern",
    role: "classification_membership", role_id: "membership", role_title: "Принадлежность",
    concept_icon: "style_historicism", concept_color: "#A9381F",
    citations: [{ source_entity_id: 1, source_slug: "s", source_title: "Источник" }],
  };
  const set = {
    id: "s", code: "style_solutions", title: "Стили",
    fields: [{ slot: "concept", title: "Понятие" }],
    links: [link],
    similar: [{ id: 42, title: "Пример", slug: "example", concepts: [7] }],
  };
  const html = styleAnalysis({ relation_sets: [set] } as unknown as PublicCard);
  const sources = html.split('class="style-pane pane-2"')[1] ?? "";
  if (!sources.includes(conceptIconPaths("style_historicism"))) throw Error("нет знака в источниках");
  const similar = html.split('class="style-pane pane-1"')[1] ?? "";
  if (!similar.includes(conceptIconPaths("style_historicism"))) throw Error("нет знака у близкого объекта");
  if (!similar.includes("Модерн")) throw Error("потеряно название понятия");
});
