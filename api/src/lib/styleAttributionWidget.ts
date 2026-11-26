import { entityPath, escapeHtml as e } from "./site.ts";
import { AXES } from "./classificationValidation.ts";
import { conceptIconSvg } from "./conceptIcons.ts";
import type { ConceptAxis } from "./conceptIcons.ts";
import type { PublicRelationSet } from "./publicRelationSets.ts";
import type { PublicCard } from "./publicCard.ts";

type Relation = PublicRelationSet["links"][number];
type Citation = Relation["citations"][number];

/** Оси классификации — по ним выбирается запасной знак (Р2.6). */
const AXIS_ORDER = ["art_epochs", "art_styles", "form_method", "morphological_trait"] as const;

/** Ось, где вместо числа — пиктограмма и мягкая заливка (Р2.4). */
const AXIS_FILL_ONLY: ConceptAxis = "morphological_trait";

/**
 * Ось связи: код типа понятия, если это одна из четырёх осей
 * классификации. Прочие типы (например, изображения) понятиями не
 * являются — им знак не полагается.
 */
function axisOf(link: Relation): ConceptAxis | null {
  const code = link.other_type_code;
  return (AXIS_ORDER as readonly string[]).includes(code ?? "") ? (code as ConceptAxis) : null;
}

/** Цвет понятия из данных: только HEX, иначе цвет своей оси (Р25, Р2.6). */
function conceptColor(color: string | null | undefined): string {
  const value = typeof color === "string" ? color.trim() : "";
  return /^#[0-9a-f]{3,8}$/i.test(value) ? value : "";
}

/**
 * Знак понятия инлайном: свой ключ — свой знак, неизвестный — знак своей оси
 * (Р2.6, Р11, Р12). Знак несут ссылка или строка понятия; цвет приходит из
 * данных и живёт переменной `--concept-color` (Р25), сам знак окрашивается
 * через `currentColor`, поэтому гость без JavaScript его видит.
 */
function conceptMark(link: Relation, axis: ConceptAxis | null, size = 16): string {
  if (!axis) return "";
  const color = conceptColor(link.concept_color);
  const style = color ? ` style="--concept-color:${color}"` : "";
  return `<span class="style-concept"${style}>${
    conceptIconSvg(link.concept_icon, axis, { size })
  }</span>`;
}

/**
 * Ссылка на понятие вместе со знаком: знак часть названия и живёт внутри
 * ссылки, чтобы не ломать сетку строки профиля.
 */
function conceptLink(link: Relation, axis: ConceptAxis | null, size = 16): string {
  return `<a href="${e(entityPath(link.other_slug))}">${
    conceptMark(link, axis, size)
  }${e(link.other_title)}</a>`;
}

/** Понятие на оси: голоса за и голоса против. */
interface AxisConcept {
  link: Relation;
  sources: Set<number>;
  objections: Set<number>;
}

interface AxisSummary {
  concepts: Map<number, AxisConcept>;
  total: number;
}

/**
 * Сводка по осям (Р2.2–Р2.5): понятие — один чип на ось, сколько бы зон и
 * ролей оно ни встречало; голос считается по уникальным источникам, а
 * знаменатель — сумма голосов понятий оси. Отрицание в знаменатель не
 * попадает, но помечает чип (Р2.5); понятие без положительной поддержки
 * показывается без числа и без заливки (Р18).
 */
function axisSummaries(links: Relation[]): Map<ConceptAxis, AxisSummary> {
  const axes = new Map<ConceptAxis, AxisSummary>(
    AXIS_ORDER.map((axis) => [axis, { concepts: new Map(), total: 0 }]),
  );
  for (const link of links) {
    const axis = axisOf(link);
    if (!axis) continue;
    const summary = axes.get(axis)!;
    const entry = summary.concepts.get(link.other_id) ?? {
      link,
      sources: new Set<number>(),
      objections: new Set<number>(),
    };
    for (const q of link.citations) {
      if (link.role === "classification_negation") entry.objections.add(q.source_entity_id);
      else entry.sources.add(q.source_entity_id);
    }
    summary.concepts.set(link.other_id, entry);
  }
  for (const summary of axes.values()) {
    summary.total = [...summary.concepts.values()].reduce((sum, c) => sum + c.sources.size, 0);
  }
  return axes;
}

/** Чип понятия: знак, название, доля по оси; оспаривание — знаком, не цветом. */
function chipHtml(concept: AxisConcept, total: number, axis: ConceptAxis): string {
  const supported = concept.sources.size > 0;
  const share = supported && total > 0 ? (100 * concept.sources.size / total) : 0;
  const shareText = share.toLocaleString("ru", { maximumFractionDigits: 1 });
  const color = conceptColor(concept.link.concept_color);
  const variables = [color ? `--concept-color:${color}` : "", axis === AXIS_FILL_ONLY && supported ? `--fill:${shareText}%` : ""]
    .filter(Boolean)
    .join("; ");
  const style = variables ? ` style="${variables}"` : "";
  const share_markup = supported && axis !== AXIS_FILL_ONLY
    ? `<span class="style-chip-share">${shareText}%</span>`
    : "";
  const objection = concept.objections.size > 0
    ? `<span class="style-chip-mark" role="img" aria-label="Оспаривается: ${
      concept.objections.size
    } ист."></span>`
    : "";
  return `<li class="style-chip"${style}${
    concept.objections.size ? ' data-objected="true"' : ""
  }><a class="style-chip-link" href="${e(entityPath(concept.link.other_slug))}">${
    conceptMark(concept.link, axis)
  }<span class="style-chip-name">${e(concept.link.other_title)}</span></a>${
    share_markup
  }${objection}</li>`;
}

/**
 * Компактная сводка (режим 1, Р2): чипы по заполненным осям, итоговые
 * счётчики. Не растягивает страницу — чипы переносятся (Р2.8).
 */
function compactSummary(links: Relation[]): string {
  const axes = axisSummaries(links);
  const sources = new Set<number>();
  let relations = 0;
  for (const link of links) {
    if (link.role === "classification_negation") continue;
    relations++;
    for (const q of link.citations) sources.add(q.source_entity_id);
  }
  const blocks: string[] = [];
  for (const axis of AXIS_ORDER) {
    const summary = axes.get(axis)!;
    const concepts = [...summary.concepts.values()].sort((a, b) =>
      b.sources.size - a.sources.size ||
      a.link.other_title.localeCompare(b.link.other_title, "ru")
    );
    if (!concepts.length) continue;
    const chips = concepts.map((c) => chipHtml(c, summary.total, axis)).join("");
    blocks.push(
      `<section class="style-axis" data-axis="${axis}"><h3>${e(AXES[axis])}</h3><ul class="style-chips">${chips}</ul></section>`,
    );
  }
  if (!blocks.length) return "";
  const foot = `<div class="style-summary-foot"><span class="style-counter">Источники: ${
    sources.size
  }</span><span class="style-counter">Связи: ${relations}</span><span class="style-counter">Оси: ${
    blocks.length
  }</span><button type="button" class="style-research" data-style-research>Исследовать</button></div>`;
  return `<div class="style-summary">${blocks.join("")}${foot}</div>`;
}

export function styleAnalysis(card: Readonly<PublicCard>, design?: string | null): string {
  return styleAttributionWidgetHtml(
    card.relation_sets?.find((set) => set.code === "style_solutions"),
    design,
    card.id,
  );
}

function anchor(slug: string, title: string): string {
  return `<a href="${e(entityPath(slug))}">${e(title)}</a>`;
}

type Witnesses = Map<number, {link: Relation; citations: Citation[]}>;
function addWitness(witnesses: Witnesses, link: Relation, citation: Citation) {
  const entry = witnesses.get(link.id) ?? {link, citations: []};
  entry.citations.push(citation);
  witnesses.set(link.id, entry);
}

function witnessPopup(witnesses: Witnesses, id?: string): string {
  const items = [...witnesses.values()].map(({link, citations}) => {
    const heading = [link.role_title, link.other_title].filter(Boolean).map(e).join(" — ");
    const evidence = citations.map(q => {
      const context = [q.locator, q.phase, q.zone].filter(Boolean).map(e).join(" · ");
      const source = q.source_title ? anchor(q.source_slug, q.source_title) : "";
      return `<span class="hint-evidence">${source}${context ? " · " + context : ""}${q.quote ? `<span>«${e(q.quote)}»</span>` : ""}</span>`;
    }).join("");
    return `<span class="hint-relation"><b>${heading}</b>${link.justification ? `<span>${e(link.justification)}</span>` : ""}${evidence}</span>`;
  }).join("");
  return `<small class="witness-popup" role="tooltip"${id ? ` id="${id}"` : ""}>${items}</small>`;
}

/**
 * Профиль — раскрытый режим (Р3).
 *
 * `hints` решает, где живут свидетельства: в первичном HTML их нет (Р22),
 * строка несёт адрес связи, и подсказка приходит по требованию; в поп-апе
 * подсказки вставлены сразу — там вес разметки не важен.
 */
function profile(links: Relation[], setId: string, hints: boolean, prefix: string): string {
  let rowNumber = 0;
  const profileOrder = ["art_epochs", "art_styles", "form_method", "morphological_trait"] as const;
  return profileOrder.map(axis => {
    const title = AXES[axis];
    const defaultRole = axis === "art_epochs" || axis === "art_styles"
      ? "classification_membership" : "classification_trait";
    const objections = new Map<number, {link: Relation; sources: Set<number>; contexts: Set<string>; witnesses: Witnesses}>();
    function objectionLabel(note: NonNullable<ReturnType<typeof objections.get>>, showConcept = false): string {
      const context = [...note.contexts].map(e).join("; ");
      const id = `score-hint-${e(prefix)}-${++rowNumber}`;
      const concept = showConcept ? conceptLink(note.link, axis) + " · " : "";
      const described = hints
        ? ` aria-describedby="${id}"`
        : ` data-style-hint="${note.link.id}" data-style-hint-id="${id}"`;
      return `<span class="style-objection" tabindex="0"${described}>${concept}Оспаривается: ${note.sources.size} ист.${
        context ? " · " + context : ""
      }${hints ? witnessPopup(note.witnesses, id) : ""}</span>`;
    }
    const groups = new Map<
      string,
      {
        label: string;
        isDefault: boolean;
        concepts: Map<number, { link: Relation; sources: Set<number>; witnesses: Witnesses }>;
      }
    >();
    for (const link of links.filter((l) => l.other_type_code === axis)) {
      for (const citation of link.citations) {
        if (link.role === "classification_negation") {
          const note = objections.get(link.other_id) ?? {link, sources: new Set<number>(), contexts: new Set<string>(), witnesses: new Map()};
          addWitness(note.witnesses, link, citation);
          note.sources.add(citation.source_entity_id);
          const context = [citation.phase, citation.zone].filter(Boolean).join(" · ");
          if (context) note.contexts.add(context);
          objections.set(link.other_id, note);
          continue;
        }
        const key = JSON.stringify([link.role_id, citation.phase || "", citation.zone || ""]);
        const group = groups.get(key) ??
          {
            isDefault: link.role === defaultRole && !citation.phase && !citation.zone,
            label: [link.role_title, citation.phase, citation.zone].filter(Boolean).join(" · "),
            concepts: new Map(),
          };
        groups.set(key, group);
        const concept = group.concepts.get(link.other_id) ??
          { link, sources: new Set(), witnesses: new Map() };
        concept.sources.add(citation.source_entity_id);
        addWitness(concept.witnesses, link, citation);
        group.concepts.set(link.other_id, concept);
      }
    }
    // Put unlabelled scores first so they cannot appear under a preceding group heading.
    const ordered = [...groups.values()].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
    const body = ordered.map((group) => {
      const concepts = [...group.concepts.values()].sort((a, b) =>
        b.sources.size - a.sources.size ||
        a.link.other_title.localeCompare(b.link.other_title, "ru")
      );
      const total = concepts.reduce((sum, c) => sum + c.sources.size, 0);
      const heading = group.isDefault ? "" : `<h4>${e(group.label)}</h4>`;
      return heading + concepts.map((c) => {
        const percent = (100 * c.sources.size / total).toLocaleString("ru", {
          maximumFractionDigits: 1,
        });
        const hintId = `score-hint-${e(prefix)}-${++rowNumber}`;
        const note = c.link.role === defaultRole ? objections.get(c.link.other_id) : undefined;
        if (note) objections.delete(c.link.other_id);
        const support = note ? `За: ${c.sources.size} ист. (${percent}%)` : `${percent}%`;
        const described = hints
          ? ` aria-describedby="${hintId}"`
          : ` data-style-hint="${c.link.id}" data-style-hint-id="${hintId}"`;
        return `<div class="style-score" tabindex="0"${described} style="--score-share:${100 * c.sources.size / total}%">${
          conceptLink(c.link, axis)
        } <strong>${support}</strong><meter aria-label="${
          e(c.link.other_title)
        }" min="0" max="${total}" value="${c.sources.size}"></meter>${
          hints ? witnessPopup(c.witnesses, hintId) : ""
        }</div>` +
          (note ? `<div class="style-counterbar">${objectionLabel(note)}</div>` : "");
      }).join("");
    }).join("");
    const negativeRows = [...objections.values()].map(note =>
      `<div class="style-counterbar style-negative">${objectionLabel(note, true)}</div>`
    ).join("");
    return `<section data-axis="${axis}"><h3>${e(title)}</h3>${
      (body + negativeRows) || '<p class="hint">Нет оценки</p>'
    }</section>`;
  }).join("");
}

function evidence(set: PublicRelationSet): string {
  const sources = new Map<number, { source: Citation; items: string[] }>();
  for (const link of set.links) {
    for (const q of link.citations) {
      const group = sources.get(q.source_entity_id) ?? { source: q, items: [] };
      const values: Record<string, string> = {
        concept: conceptLink(link, axisOf(link)),
        relation: e(link.role_title),
        rationale: e(link.justification),
        quote: q.quote ? `<blockquote>${e(q.quote)}</blockquote>` : "",
        phase: e(q.phase),
        zone: e(q.zone),
      };
      const fields = set.fields.filter((f) => values[f.slot]).map((f) =>
        `<dt>${e(f.title)}</dt><dd>${values[f.slot]}</dd>`
      ).join("");
      group.items.push(
        `<li data-relation-id="${e(link.id)}"><dl>${fields}</dl>${
          q.locator ? `<small>${e(q.locator)}</small>` : ""
        }</li>`,
      );
      sources.set(q.source_entity_id, group);
    }
  }
  const sections = Array.from(
    sources.values(),
    ({ source, items }) =>
      `<section><h3>${anchor(source.source_slug, source.source_title)}</h3><ul>${
        items.join("")
      }</ul></section>`,
  ).join("");
  const uncited = set.links.filter((l) => !l.citations.length).map((l) =>
    `<li>${anchor(l.other_slug, l.other_title)} · ${e(l.role_title)}<p>${
      e(l.justification)
    }</p></li>`
  ).join("");
  return (sections || '<p class="hint">Источники пока отсутствуют.</p>') +
    (uncited ? `<h3>Связи без доступного источника</h3><ul>${uncited}</ul>` : "");
}

/** Части полного вида: профиль, близкие объекты, источники. */
const PARTS = ["profile", "similar", "sources"] as const;
type Part = (typeof PARTS)[number];

/** Переключатели вкладок: связь по признаку, а не по позиции (Р20). */
function tabInputs(prefix: string): string {
  const labels: [string, Part][] = [
    ["Профиль", "profile"],
    ["Близкие объекты", "similar"],
    ["Источники", "sources"],
  ];
  return labels.map(([label, part], i) =>
    `<input class="style-choice" type="radio" id="${e(prefix)}-${i}" name="${e(prefix)}" data-style-tab="${part}"${
      i === 0 ? " checked" : ""
    }><label for="${e(prefix)}-${i}">${label}</label>`
  ).join("");
}

/** Панели вкладок — каждая с признаком своей части. */
function tabPanes(parts: Record<Part, string>): string {
  return PARTS.map((part) => `<div class="style-pane" data-style-pane="${part}">${parts[part]}</div>`).join("");
}

/** Близкие объекты — общие понятия с одинаковой ролью. */
function similarObjects(set: PublicRelationSet): string {
  const titles = new Map(set.links.map((l) => [String(l.other_id), l.other_title]));
  const byId = new Map(set.links.map((l) => [String(l.other_id), l]));
  const matches = (set.similar ?? []).map((obj) =>
    `<li>${anchor(obj.slug, obj.title)}<p>${
      obj.concepts.map((id) => {
        const link = byId.get(String(id));
        const title = e(titles.get(String(id)));
        const mark = link ? conceptMark(link, axisOf(link)) : "";
        return mark ? `${mark} ${title}` : title;
      }).join(" · ")
    }</p></li>`
  ).join("");
  return matches
    ? `<p>По числу общих понятий с одинаковой ролью. Отрицания исключены.</p><ol>${matches}</ol>`
    : '<p class="hint">Объектов с общими атрибуциями пока нет.</p>';
}

export function styleAttributionWidgetHtml(
  set: PublicRelationSet | undefined,
  design?: string | null,
  uid?: number | null,
): string {
  if (!set) return "";
  // Режим 1 — компактный по умолчанию; «expanded» в макете открывает профиль (Р6).
  const expanded = design === "expanded";
  const prefix = `style-${e(set.id)}`;
  const head = `<details open class="parameter-set-relations style-analysis rel-box" data-parameter-set="${
    e(set.id)
  }" data-style-mode="${expanded ? "expanded" : "compact"}"${
    uid ? ` data-style-uid="${uid}"` : ""
  }><summary><span role="heading" aria-level="2">${
    e(set.title)
  }</span></summary>`;
  if (!set.links.length) {
    return head + '<p class="hint">Опубликованных связей пока нет.</p></details>';
  }
  // Профиль — раскрытый режим (Р3): в потоке карточки, по кнопке или сразу,
  // если так задан макетом (Р6). Переход без перезагрузки (Р5). Свидетельства
  // строк в первичном HTML не лежат — они приходят по требованию (Р22);
  // вкладки «Близкие объекты» и «Источники» тоже подгружаются по требованию.
  const profileBlock = `<details class="style-profile"${
    expanded ? " open" : ""
  }><summary class="style-profile-toggle"><span class="style-when-closed">Развернуть профиль</span><span class="style-when-open">Свернуть профиль</span></summary><fieldset class="style-tabs"><legend>Стилистический анализ</legend>${
    tabInputs(prefix)
  }${
    tabPanes({
      profile: profile(set.links, set.id, false, prefix),
      similar: "",
      sources: "",
    })
  }</fieldset></details>`;
  return head + compactSummary(set.links) + profileBlock + "</details>";
}

/**
 * Полный вид для поп-апа и для подгрузки вкладок (Р22, Р4): профиль со
 * свидетельствами, близкие объекты и источники. Префикс вкладок свой — в
 * документе уже есть вкладки карточки (Р13).
 */
export function styleAnalysisPopupHtml(set: PublicRelationSet): string {
  const prefix = `style-popup-${e(set.id)}`;
  return `<fieldset class="style-tabs style-tabs-popup"><legend>Стилистический анализ</legend>${
    tabInputs(prefix)
  }${
    tabPanes({
      profile: profile(set.links, set.id, true, prefix),
      similar: similarObjects(set),
      sources: evidence(set),
    })
  }</fieldset>`;
}

/**
 * Свидетельства по связи — для подсказки, которая приходит по требованию
 * (Р22). Берутся все связи того же понятия: положительные или отрицания.
 */
export function styleAnalysisHintHtml(set: PublicRelationSet, linkId: number): string {
  const link = set.links.find((l) => l.id === linkId);
  if (!link) return "";
  const negation = link.role === "classification_negation";
  const witnesses: Witnesses = new Map();
  for (const l of set.links) {
    if (l.other_id !== link.other_id) continue;
    if ((l.role === "classification_negation") !== negation) continue;
    for (const q of l.citations) {
      const entry = witnesses.get(l.id) ?? { link: l, citations: [] };
      entry.citations.push(q);
      witnesses.set(l.id, entry);
    }
  }
  return witnessPopup(witnesses);
}
