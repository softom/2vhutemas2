import {
  styleAnalysis,
  styleAnalysisHintHtml,
  styleAnalysisPopupHtml,
} from "./styleAttributionWidget.ts";
import { conceptIconPaths } from "./conceptIcons.ts";
import type { PublicCard } from "./publicCard.ts";
import type { PublicRelationSet } from "./publicRelationSets.ts";

/** Панель вкладки по её признаку — вкладки адресуются признаком (Р20). */
function pane(html: string, name: string): string {
  const marker = `<div class="style-pane" data-style-pane="${name}">`;
  const start = html.indexOf(marker);
  if (start < 0) return "";
  const body = start + marker.length;
  // Внутри панели вложенных div может быть — считаем закрытие по балансу.
  let depth = 1;
  let cursor = body;
  while (cursor < html.length) {
    const open = html.indexOf("<div", cursor);
    const close = html.indexOf("</div>", cursor);
    if (close < 0) return html.slice(body);
    if (open >= 0 && open < close) {
      depth++;
      cursor = open + 4;
      continue;
    }
    depth--;
    if (depth === 0) return html.slice(body, close);
    cursor = close + 6;
  }
  return html.slice(body);
}

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
  // Первичный HTML лёгкий: вкладка «Источники» приходит по требованию (Р22).
  const rows = html.match(/<section><h3><a.*?<\/section>/g) ?? [];
  if (rows.length) throw Error("источники попали в первичный HTML");
  const popup = styleAnalysisPopupHtml(set as unknown as PublicRelationSet);
  const sections = popup.split('<section><h3><a').slice(1).map((part) => '<section><h3><a' + part.split("</section>")[0]);
  if (
    !popup.includes("&lt;обоснование&gt;") || !popup.includes("Отрицание") ||
    !popup.includes('href="/entities/concept"') || sections.length !== 2 ||
    !/first.*Цитата А.*1930.*Фасад/.test(sections[0]) || !/second.*Цитата Б.*1960/.test(sections[1]) ||
    sections[1].includes("Фасад") || sections[1].includes("<dt>zone")
  ) throw Error(popup);
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
  const popup = styleAnalysisPopupHtml(set as unknown as PublicRelationSet);
  // Профиль и его доли — в первичном HTML.
  for (const expected of [
    "66,7%",
    "33,3%",
    "Отрицание · 1930 · Фасад",
    "1930 · Башня",
    "Метод формообразования",
  ]) {
    if (!html.includes(expected)) throw Error(expected);
  }
  // Свидетельства и близкие объекты — по требованию, в полном виде (Р22).
  for (const expected of ["Принадлежность — Модерн", 'href="/entities/example"']) {
    if (!popup.includes(expected)) throw Error(expected);
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
    const section = (html.split('<details class="style-profile"')[1] ?? "").split(`data-axis="${axis}">`)[1].split("</section>")[0];
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
  const html = styleAnalysis({relation_sets:[set]} as unknown as PublicCard).split('<details class="style-profile"')[1].split('data-axis="art_styles">')[1].split("</section>")[0];
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
  const html = styleAnalysisPopupHtml(set as unknown as PublicRelationSet);
  const sources = pane(html, "sources");
  if (!sources.includes(conceptIconPaths("style_historicism"))) throw Error("нет знака в источниках");
  const similar = pane(html, "similar");
  if (!similar.includes(conceptIconPaths("style_historicism"))) throw Error("нет знака у близкого объекта");
  if (!similar.includes("Модерн")) throw Error("потеряно название понятия");
});

Deno.test("compact summary shows one chip per concept with its share by unique sources", () => {
  const citation = (source_entity_id: number, zone = "") => ({
    source_entity_id, source_slug: "s", source_title: "Источник", zone,
  });
  const first = {
    id: 1, other_id: 7, other_type_code: "art_styles", other_title: "Модерн", other_slug: "modern",
    role: "classification_membership", role_id: "membership", role_title: "Принадлежность",
    concept_icon: "style_historicism", concept_color: "#A9381F",
    citations: [citation(1), citation(2)],
  };
  const set = {
    id: "s", code: "style_solutions", title: "Стили", fields: [], links: [
      first,
      // То же понятие в другой зоне — один чип, голоса считаются по объединению.
      { ...first, id: 2, citations: [citation(2, "Башня"), citation(3)] },
      { ...first, id: 3, other_id: 8, other_title: "Архитектура", other_slug: "architecture",
        citations: [citation(4), citation(5)] },
    ],
  };
  const html = styleAnalysis({ relation_sets: [set] } as unknown as PublicCard);
  const summary = html.split('<div class="style-summary">')[1]?.split("</div></details>")[0] ?? "";
  const chips = summary.match(/<li class="style-chip"/g) ?? [];
  if (chips.length !== 2) throw Error(`чипов ${chips.length}, ожидалось 2`);
  if (!summary.includes("60%") || !summary.includes("40%")) throw Error("нет долей по уникальным источникам");
  if (!summary.includes("Источники: 5") || !summary.includes("Связи: 3") || !summary.includes("Оси: 1")) {
    throw Error("нет итоговых счётчиков");
  }
  if (!summary.includes('style="--concept-color:#A9381F"')) throw Error("нет цвета понятия в чипе");
  if (!summary.includes(conceptIconPaths("style_historicism"))) throw Error("нет знака в чипе");
  // Компактный режим — по умолчанию; профиль свёрнут и открывается по кнопке.
  if (!html.includes('data-style-mode="compact"')) throw Error("нет компактного режима");
  if (!html.includes('<details class="style-profile">')) throw Error("профиль не свёрнут");
  if (html.includes('<details class="style-profile" open>')) throw Error("профиль открыт по умолчанию");
});

Deno.test("compact summary marks objections and fills the trait axis instead of numbers", () => {
  const link = {
    id: 1, other_id: 7, other_type_code: "art_styles", other_title: "Модерн", other_slug: "modern",
    role: "classification_membership", role_id: "membership", role_title: "Принадлежность",
    concept_icon: "style_historicism", concept_color: "#A9381F",
    citations: [{ source_entity_id: 1, source_slug: "s", source_title: "Источник" }],
  };
  const negation = {
    id: 2, other_id: 7, other_type_code: "art_styles", other_title: "Модерн", other_slug: "modern",
    role: "classification_negation", role_id: "negation", role_title: "Отрицание",
    citations: [{ source_entity_id: 2, source_slug: "s", source_title: "Источник" }],
  };
  const trait = {
    id: 3, other_id: 9, other_type_code: "morphological_trait", other_title: "Остекление", other_slug: "glass",
    role: "classification_trait", role_id: "trait", role_title: "Наличие признака",
    concept_icon: "trait_corner_glass", concept_color: "#3B6E8C",
    citations: [{ source_entity_id: 1, source_slug: "s", source_title: "Источник" }],
  };
  const set = { id: "s", code: "style_solutions", title: "Стили", fields: [], links: [link, negation, trait] };
  const html = styleAnalysis({ relation_sets: [set] } as unknown as PublicCard);
  const summary = html.split('<div class="style-summary">')[1]?.split("</div></details>")[0] ?? "";
  if (!summary.includes('data-objected="true"')) throw Error("оспоривание не помечено");
  if (!summary.includes("Оспаривается: 1 ист.")) throw Error("нет счётчика оспаривания");
  // Оспаривание — знаком, цвет понятия сохраняется.
  if (!summary.includes("--concept-color:#A9381F")) throw Error("оспоривание заменило цвет");
  // Ось признаков: мягкая заливка вместо чисел (Р2.4).
  const traitAxis = summary.split('data-axis="morphological_trait"')[1] ?? "";
  if (traitAxis.includes("style-chip-share")) throw Error("на оси признаков есть числа");
  if (!traitAxis.includes("--fill:100%")) throw Error("нет заливки по доле");
});

Deno.test("expanded design opens the profile and hides the compact summary", () => {
  const link = {
    id: 1, other_id: 7, other_type_code: "art_styles", other_title: "Модерн", other_slug: "modern",
    role: "classification_membership", role_id: "membership", role_title: "Принадлежность",
    concept_icon: "style_historicism", concept_color: "#A9381F",
    citations: [{ source_entity_id: 1, source_slug: "s", source_title: "Источник" }],
  };
  const set = { id: "s", code: "style_solutions", title: "Стили", fields: [], links: [link] };
  const html = styleAnalysis({ relation_sets: [set] } as unknown as PublicCard, "expanded");
  if (!html.includes('data-style-mode="expanded"')) throw Error("нет раскрытого режима");
  if (!html.includes('<details class="style-profile" open>')) throw Error("профиль не открыт");
  if (!html.includes('<div class="style-summary">')) throw Error("нет сводки в разметке");
  if (!html.includes("Свернуть профиль")) throw Error("нет подписи закрытия");
});

Deno.test("compact summary falls back to the axis colour and icon", () => {
  const link = {
    id: 1, other_id: 7, other_type_code: "art_styles", other_title: "Новое понятие", other_slug: "new",
    role: "classification_membership", role_id: "membership", role_title: "Принадлежность",
    concept_icon: null, concept_color: null,
    citations: [{ source_entity_id: 1, source_slug: "s", source_title: "Источник" }],
  };
  const set = { id: "s", code: "style_solutions", title: "Стили", fields: [], links: [link] };
  const html = styleAnalysis({ relation_sets: [set] } as unknown as PublicCard);
  const summary = html.split('<div class="style-summary">')[1]?.split("</div></details>")[0] ?? "";
  if (!summary.includes(conceptIconPaths("axis_styles"))) throw Error("нет запасного знака оси");
  if (summary.includes("--concept-color")) throw Error("цвет без данных");
  if (!summary.includes("style-chip-share")) throw Error("нет доли у понятия");
});

Deno.test("compact summary and expanded profile agree on concepts and sources", () => {
  const citation = (source_entity_id: number, zone = "") => ({
    source_entity_id, source_slug: "s", source_title: "Источник", zone,
  });
  const link = (id: number, axis: string, title: string, citations: number[], zone = "") => ({
    id, other_id: id, other_type_code: axis, other_title: title, other_slug: "c" + id,
    role: axis === "art_styles" ? "classification_membership" : "classification_trait",
    role_id: axis === "art_styles" ? "membership" : "trait", role_title: "Роль",
    concept_icon: "style_historicism", concept_color: "#A9381F",
    citations: citations.map((source_entity_id) => citation(source_entity_id, zone)),
  });
  const links = [
    link(1, "art_styles", "Первый", [1, 2]),
    link(2, "art_styles", "Второй", [2, 3], "Башня"),
    link(3, "art_styles", "Первый", [4], "Башня"),
    link(4, "form_method", "Метод", [5]),
    link(5, "form_method", "Другой метод", [6, 7]),
  ];
  const set = { id: "s", code: "style_solutions", title: "Стили", fields: [], links };
  const html = styleAnalysis({ relation_sets: [set] } as unknown as PublicCard);
  const summary = html.split('<div class="style-summary">')[1]?.split("</div></details>")[0] ?? "";
  const profile = html.split('<details class="style-profile"')[1] ?? "";

  const linksOf = (block: string, pattern: RegExp) =>
    [...new Set([...block.matchAll(pattern)].map((m) => m[1]))].sort();
  for (const axis of ["art_epochs", "art_styles", "form_method", "morphological_trait"]) {
    const compactAxis = summary.split(`data-axis="${axis}">`)[1]?.split("</section>")[0] ?? "";
    const profileAxis = profile.split(`data-axis="${axis}">`)[1]?.split("</section>")[0] ?? "";
    if (!compactAxis && !profileAxis) continue;
    const chips = linksOf(compactAxis, /class="style-chip-link" href="([^"]+)"/g);
    const concepts = linksOf(profileAxis, /class="style-score"[^>]*><a href="([^"]+)"/g);
    if (chips.join() !== concepts.join()) {
      throw Error(`${axis}: чипы ${chips.join()} против понятий профиля ${concepts.join()}`);
    }
  }
  // Счётчик источников — по уникальным источникам всех связей набора.
  const sources = new Set(links.flatMap((l) => l.citations.map((c) => c.source_entity_id)));
  if (!summary.includes(`Источники: ${sources.size}`)) throw Error("счётчик источников неверен");
});

/** Набор для сценариев этапа 6: понятие, его отрицание и второе понятие. */
function stage6Set() {
  const citation = (source_entity_id: number, zone = "") => ({
    source_entity_id, source_slug: "src", source_title: "Источник", zone,
  });
  const link = {
    id: 1, other_id: 7, other_type_code: "art_styles", other_title: "Модерн", other_slug: "modern",
    role: "classification_membership", role_id: "membership", role_title: "Принадлежность",
    concept_icon: "style_historicism", concept_color: "#A9381F",
    citations: [citation(10), citation(11)],
  };
  const negation = {
    id: 2, other_id: 7, other_type_code: "art_styles", other_title: "Модерн", other_slug: "modern",
    role: "classification_negation", role_id: "negation", role_title: "Отрицание",
    concept_icon: "style_historicism", concept_color: "#A9381F",
    citations: [citation(12)],
  };
  const other = {
    id: 3, other_id: 8, other_type_code: "art_styles", other_title: "Архитектура", other_slug: "architecture",
    role: "classification_membership", role_id: "membership", role_title: "Принадлежность",
    concept_icon: "style_historicism", concept_color: "#A9381F",
    citations: [citation(13)],
  };
  return {
    id: "s", code: "style_solutions", title: "Стили", fields: [],
    links: [link, negation, other],
    similar: [{ id: 42, title: "Пример", slug: "example", concepts: [7] }],
  };
}

Deno.test("primary html stays light: no witnesses, empty lazy panes, hint markers instead", () => {
  const set = stage6Set();
  const primary = styleAnalysis({ relation_sets: [set] } as unknown as PublicCard);
  // Свидетельств в первичном HTML нет — они приходят по требованию (Р22).
  if (primary.includes("witness-popup")) throw Error("свидетельства в первичном HTML");
  if (primary.includes("aria-describedby")) throw Error("подсказка уже встроена");
  // Строка профиля несёт адрес связи, по которому подсказка и придёт.
  if (!primary.includes('data-style-hint="1"')) throw Error("нет адреса связи");
  if (!primary.includes('data-style-hint="2"')) throw Error("нет адреса связи отрицания");
  if (!/data-style-hint-id="score-hint-style-s-\d+-\d+"/.test(primary)) throw Error("нет адреса подсказки");
  // Адрес строки — связь, фаза и часть объекта (Р15).
  if (!primary.includes('data-style-phase=""') || !primary.includes('data-style-zone=""')) {
    throw Error("нет фазы и части объекта в адресе");
  }
  // Вкладки «Близкие объекты» и «Источники» пусты до запроса.
  if (pane(primary, "similar") !== "") throw Error("вкладка близких объектов не пуста");
  if (pane(primary, "sources") !== "") throw Error("вкладка источников не пуста");
  if (!pane(primary, "profile").includes("Модерн")) throw Error("профиль пуст");
  // Поп-ап открывается по действию читателя — кнопка есть в первичном HTML.
  if (!primary.includes("data-style-research")) throw Error("нет кнопки «Исследовать»");
  // Первичный профиль легче: в нём нет свидетельств, они приходят по требованию.
  const popup = styleAnalysisPopupHtml(set as unknown as PublicRelationSet);
  if (pane(primary, "profile").length >= pane(popup, "profile").length) {
    throw Error("первичный профиль не легче полного");
  }
});

Deno.test("popup carries all three parts with witnesses and their own tab prefix", () => {
  const set = stage6Set();
  const popup = styleAnalysisPopupHtml(set as unknown as PublicRelationSet);
  for (const part of ["profile", "similar", "sources"]) {
    if (!popup.includes(`data-style-pane="${part}"`)) throw Error(`нет части ${part}`);
  }
  // Свидетельства в полном виде уже внутри, с адресом для aria-describedby.
  const profile = pane(popup, "profile");
  if (!profile.includes('class="witness-popup"')) throw Error("нет подсказок в полном виде");
  if (!profile.includes('role="tooltip"')) throw Error("нет роли подсказки");
  if (!/aria-describedby="score-hint-style-popup-s-\d+-\d+"/.test(profile)) {
    throw Error("нет связи подсказки со строкой");
  }
  if (!pane(popup, "similar").includes('href="/entities/example"')) throw Error("нет близких объектов");
  if (!pane(popup, "sources").includes("Источник")) throw Error("нет источников");
  // Свой префикс вкладок: в документе уже есть вкладки карточки (Р13).
  if (!/id="style-popup-s-\d+-0"/.test(popup) || !/name="style-popup-s-\d+"/.test(popup)) {
    throw Error("нет своего префикса вкладок");
  }
});

Deno.test("hint for a link brings the witnesses of the same concept only", () => {
  const set = stage6Set();
  const positive = styleAnalysisHintHtml(set as unknown as PublicRelationSet, 1);
  if (!positive.includes('class="witness-popup"')) throw Error("нет подсказки");
  if (!positive.includes("Принадлежность — Модерн")) throw Error("нет заголовка связи");
  if (!positive.includes("Источник")) throw Error("нет свидетельства");
  if (positive.includes("Отрицание")) throw Error("в подсказку попало отрицание");
  // Отрицание того же понятия — отдельная подсказка.
  const negative = styleAnalysisHintHtml(set as unknown as PublicRelationSet, 2);
  if (!negative.includes("Отрицание — Модерн")) throw Error("нет заголовка отрицания");
  if (negative.includes("Принадлежность")) throw Error("в подсказку попала положительная связь");
  // Чужой связи нет — пустой ответ, а не чужая подсказка.
  if (styleAnalysisHintHtml(set as unknown as PublicRelationSet, 999) !== "") throw Error("чужая подсказка");
});

Deno.test("hint finds the link when the driver returns ids as strings", () => {
  const set = stage6Set();
  // Драйвер отдаёт bigint строкой — искать связь строгим сравнением нельзя.
  const asStrings = {
    ...set,
    links: set.links.map((l) => ({ ...l, id: String(l.id), other_id: String(l.other_id) })),
  };
  const hint = styleAnalysisHintHtml(asStrings as unknown as PublicRelationSet, 1);
  if (!hint.includes("Принадлежность — Модерн")) throw Error("подсказка не найдена");
  if (styleAnalysisHintHtml(asStrings as unknown as PublicRelationSet, 999) !== "") {
    throw Error("чужая подсказка");
  }
  // Адрес в разметке и в подсказке — один и тот же.
  const primary = styleAnalysis({ relation_sets: [asStrings] } as unknown as PublicCard);
  if (!primary.includes('data-style-hint="1"')) throw Error("нет адреса связи в разметке");
});

Deno.test("tabs are addressed by feature, not by position", () => {
  const set = stage6Set();
  const primary = styleAnalysis({ relation_sets: [set] } as unknown as PublicCard);
  for (const part of ["profile", "similar", "sources"]) {
    if (!primary.includes(`data-style-tab="${part}"`)) throw Error(`нет переключателя ${part}`);
  }
  // Никаких позиционных классов: порядок вкладок может измениться (Р20).
  for (const legacy of ["pane-0", "pane-1", "pane-2", "choice-0"]) {
    if (primary.includes(legacy)) throw Error(`остался позиционный класс ${legacy}`);
  }
  if (!/id="style-s-\d+-0"/.test(primary) || !/name="style-s-\d+"/.test(primary)) {
    throw Error("нет своей группы переключателей");
  }
});

Deno.test("two instances of one set keep their own prefixes and identifiers", () => {
  const set = stage6Set();
  const first = styleAnalysis({ relation_sets: [set] } as unknown as PublicCard);
  const second = styleAnalysis({ relation_sets: [set] } as unknown as PublicCard);
  const instance = (html: string) => html.match(/data-style-instance="([^"]+)"/)?.[1] ?? "";
  const a = instance(first);
  const b = instance(second);
  if (!a || !b) throw Error("нет признака экземпляра");
  if (a === b) throw Error("префиксы экземпляров совпали");
  const ids = (html: string) => [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  const names = (html: string) => [...html.matchAll(/ name="([^"]+)"/g)].map((m) => m[1]);
  for (const [left, right, what] of [[ids(first), ids(second), "идентификаторы"], [names(first), names(second), "группы переключателей"]] as const) {
    const overlap = left.filter((value) => (right as string[]).includes(value));
    if (overlap.length) throw Error(`${what} повторились: ${overlap.join(", ")}`);
  }
  // И поп-ап — со своим префиксом (Р13).
  const popup = styleAnalysisPopupHtml(set as unknown as PublicRelationSet);
  const popupPrefix = instance(popup);
  if (!popupPrefix || popupPrefix === a || popupPrefix === b) throw Error("у поп-апа свой префикс");
});

Deno.test("row hint brings the witnesses of that row only, and the full view agrees", () => {
  const citation = (source_entity_id: number, phase: string, zone: string, quote: string) => ({
    source_entity_id, source_slug: "src", source_title: "Источник", phase, zone, quote,
  });
  const base = {
    other_id: 7, other_type_code: "art_styles", other_title: "Модерн", other_slug: "modern",
    role: "classification_membership", role_id: "membership", role_title: "Принадлежность",
    concept_icon: "style_historicism", concept_color: "#A9381F",
  };
  const set = {
    id: "s", code: "style_solutions", title: "Стили", fields: [],
    links: [
      { ...base, id: 1, citations: [citation(10, "1923", "фасад", "Цитата фасада")] },
      { ...base, id: 2, citations: [citation(11, "1960", "крыша", "Цитата крыши")] },
    ],
  };
  const facade = styleAnalysisHintHtml(set as unknown as PublicRelationSet, 1, "1923", "фасад");
  if (!facade.includes("Цитата фасада")) throw Error("нет цитаты своей строки");
  if (facade.includes("Цитата крыши")) throw Error("в подсказку попала чужая цитата");
  const roof = styleAnalysisHintHtml(set as unknown as PublicRelationSet, 2, "1960", "крыша");
  if (!roof.includes("Цитата крыши") || roof.includes("Цитата фасада")) {
    throw Error("подсказка другой строки");
  }
  // Адрес строки в разметке — тот же, что у запроса подсказки.
  const html = styleAnalysis({ relation_sets: [set] } as unknown as PublicCard);
  if (!html.includes('data-style-hint="1" data-style-phase="1923" data-style-zone="фасад"')) {
    throw Error("нет адреса строки в разметке");
  }
  // Одна и та же плашка в обоих режимах раскрывает одни и те же связи и цитаты.
  const profile = pane(styleAnalysisPopupHtml(set as unknown as PublicRelationSet), "profile");
  const shown = [...profile.matchAll(/<small class="witness-popup"[^>]*>([\s\S]*?)<\/small>/g)]
    .map((m) => m[1]);
  const body = (tip: string) => tip.replace(/^<small[^>]*>/, "").replace(/<\/small>$/, "");
  if (shown.length !== 2) throw Error(`плашек в полном виде ${shown.length}`);
  if (shown[0] !== body(facade) || shown[1] !== body(roof)) {
    throw Error("плашка и полный вид показывают разное");
  }
});
