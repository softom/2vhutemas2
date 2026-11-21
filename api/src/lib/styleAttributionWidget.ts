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

function profile(links: Relation[]): string {
  return Object.entries(AXES).map(([axis, title]) => {
    const groups = new Map<
      string,
      {
        label: string;
        concepts: Map<number, { link: Relation; sources: Set<number>; relations: Set<number> }>;
      }
    >();
    for (const link of links.filter((l) => l.other_type_code === axis)) {
      for (const citation of link.citations) {
        const key = JSON.stringify([link.role_id, citation.phase || "", citation.zone || ""]);
        const group = groups.get(key) ??
          {
            label: [link.role_title, citation.phase, citation.zone].filter(Boolean).join(" · "),
            concepts: new Map(),
          };
        groups.set(key, group);
        const concept = group.concepts.get(link.other_id) ??
          { link, sources: new Set(), relations: new Set() };
        concept.sources.add(citation.source_entity_id);
        concept.relations.add(link.id);
        group.concepts.set(link.other_id, concept);
      }
    }
    const body = Array.from(groups.values(), (group) => {
      const concepts = [...group.concepts.values()].sort((a, b) =>
        b.sources.size - a.sources.size ||
        a.link.other_title.localeCompare(b.link.other_title, "ru")
      );
      const total = concepts.reduce((sum, c) => sum + c.sources.size, 0);
      return `<h4>${e(group.label)}</h4>` + concepts.map((c) => {
        const percent = (100 * c.sources.size / total).toLocaleString("ru", {
          maximumFractionDigits: 1,
        });
        return `<div class="style-score">${
          anchor(c.link.other_slug, c.link.other_title)
        } <strong>${percent}%</strong><meter aria-label="${
          e(c.link.other_title)
        }" min="0" max="${total}" value="${c.sources.size}"></meter><small>Источников: ${c.sources.size} · связей: ${c.relations.size}</small></div>`;
      }).join("");
    }).join("");
    return `<section data-axis="${axis}"><h3>${e(title)}</h3>${
      body || '<p class="hint">Нет оценки</p>'
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
  const head = `<section class="parameter-set-relations style-analysis" data-parameter-set="${
    e(set.id)
  }"><h2>${e(set.title)}</h2>`;
  if (!set.links.length) {
    return head + '<p class="hint">Опубликованных связей пока нет.</p></section>';
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
      "<p>Доля поддержки источниками внутри одной оси, роли, фазы и части объекта. Каждый источник даёт понятию один голос.</p>" +
      profile(set.links),
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
    }</fieldset></section>`;
}
