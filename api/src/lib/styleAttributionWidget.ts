import { entityPath, escapeHtml as e } from "./site.ts";
import { AXES } from "./classificationValidation.ts";
import type { PublicRelationSet } from "./publicRelationSets.ts";
import type { PublicCard } from "./publicCard.ts";

type Relation = PublicRelationSet["links"][number];
type Citation = Relation["citations"][number];

export function styleAnalysis(card: Readonly<PublicCard>): string {
  return styleAttributionWidgetHtml(
    card.relation_sets?.find((set) => set.code === "style_solutions"),
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

function witnessPopup(witnesses: Witnesses, id: string): string {
  const items = [...witnesses.values()].map(({link, citations}) => {
    const heading = [link.role_title, link.other_title].filter(Boolean).map(e).join(" — ");
    const evidence = citations.map(q => {
      const context = [q.locator, q.phase, q.zone].filter(Boolean).map(e).join(" · ");
      const source = q.source_title ? anchor(q.source_slug, q.source_title) : "";
      return `<span class="hint-evidence">${source}${context ? " · " + context : ""}${q.quote ? `<span>«${e(q.quote)}»</span>` : ""}</span>`;
    }).join("");
    return `<span class="hint-relation"><b>${heading}</b>${link.justification ? `<span>${e(link.justification)}</span>` : ""}${evidence}</span>`;
  }).join("");
  return `<small class="witness-popup" role="tooltip" id="${id}">${items}</small>`;
}

function profile(links: Relation[], setId: string): string {
  let rowNumber = 0;
  const profileOrder = ["art_epochs", "art_styles", "form_method", "morphological_trait"] as const;
  return profileOrder.map(axis => {
    const title = AXES[axis];
    const defaultRole = axis === "art_epochs" || axis === "art_styles"
      ? "classification_membership" : "classification_trait";
    const objections = new Map<number, {link: Relation; sources: Set<number>; contexts: Set<string>; witnesses: Witnesses}>();
    function objectionLabel(note: NonNullable<ReturnType<typeof objections.get>>, showConcept = false): string {
      const context = [...note.contexts].map(e).join("; ");
      const id = `score-hint-${e(setId)}-${++rowNumber}`;
      const concept = showConcept ? anchor(note.link.other_slug, note.link.other_title) + " · " : "";
      return `<span class="style-objection" tabindex="0" aria-describedby="${id}">${concept}Оспаривается: ${note.sources.size} ист.${context ? " · " + context : ""}${witnessPopup(note.witnesses,id)}</span>`;
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
        const hintId = `score-hint-${e(setId)}-${++rowNumber}`;
        const note = c.link.role === defaultRole ? objections.get(c.link.other_id) : undefined;
        if (note) objections.delete(c.link.other_id);
        const support = note ? `За: ${c.sources.size} ист. (${percent}%)` : `${percent}%`;
        return `<div class="style-score" tabindex="0" aria-describedby="${hintId}" style="--score-share:${100 * c.sources.size / total}%">${
          anchor(c.link.other_slug, c.link.other_title)
        } <strong>${support}</strong><meter aria-label="${
          e(c.link.other_title)
        }" min="0" max="${total}" value="${c.sources.size}"></meter>${witnessPopup(c.witnesses,hintId)}</div>` +
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
        concept: anchor(link.other_slug, link.other_title),
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

export function styleAttributionWidgetHtml(set: PublicRelationSet | undefined): string {
  if (!set) return "";
  const head = `<details open class="parameter-set-relations style-analysis rel-box" data-parameter-set="${
    e(set.id)
  }"><summary><span role="heading" aria-level="2">${e(set.title)}</span></summary>`;
  if (!set.links.length) {
    return head + '<p class="hint">Опубликованных связей пока нет.</p></details>';
  }
  const titles = new Map(set.links.map((l) => [String(l.other_id), l.other_title]));
  const matches = (set.similar ?? []).map((obj) =>
    `<li>${anchor(obj.slug, obj.title)}<p>${
      e(obj.concepts.map((id) => titles.get(String(id))).join(" · "))
    }</p></li>`
  ).join("");
  const panels = [
    [
      "Профиль",
      profile(set.links, set.id),
    ],
    [
      "Близкие объекты",
      matches
        ? `<p>По числу общих понятий с одинаковой ролью. Отрицания исключены.</p><ol>${matches}</ol>`
        : '<p class="hint">Объектов с общими атрибуциями пока нет.</p>',
    ],
    ["Источники", evidence(set)],
  ];
  const tabs = panels.map(([label], i) =>
    `<input class="style-choice" type="radio" id="style-${e(set.id)}-${i}" name="style-${
      e(set.id)
    }" ${i === 0 ? "checked" : ""}><label for="style-${e(set.id)}-${i}">${label}</label>`
  ).join("");
  return head +
    `<fieldset class="style-tabs"><legend>Стилистический анализ</legend>${tabs}${
      panels.map(([, body], i) => `<div class="style-pane pane-${i}">${body}</div>`).join("")
    }</fieldset></details>`;
}
