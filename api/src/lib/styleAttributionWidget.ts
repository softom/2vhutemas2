import { entityPath, escapeHtml as e } from "./site.ts";
import type { PublicRelationSet } from "./publicRelationSets.ts";

import type { PublicCard } from "./publicCard.ts";

export function styleAnalysis(card: Readonly<PublicCard>): string {
  return styleAttributionWidgetHtml(card.relation_sets?.find(set => set.code === "style_solutions"));
}

type Relation = PublicRelationSet["links"][number];
type Citation = Relation["citations"][number];

function entityAnchor(slug: string, title: string): string {
  return `<a href="${e(entityPath(slug))}">${e(title)}</a>`;
}

function field(label: string, html: string): string {
  return html ? `<dt>${e(label)}</dt><dd>${html}</dd>` : "";
}

function evidenceHtml(citation: Citation, fields: PublicRelationSet["fields"]): string {
  const values: Record<string, string> = {
    source: entityAnchor(citation.source_slug, citation.source_title),
    quote: citation.quote ? `<blockquote>${e(citation.quote)}</blockquote>` : "",
    phase: e(citation.phase),
    zone: e(citation.zone),
  };
  const rows = fields.map(f => field(f.title, values[f.slot] ?? "")).join("");
  return rows ? `<li><dl>${rows}</dl></li>` : "";
}

function attributionHtml(link: Relation, fields: PublicRelationSet["fields"]): string {
  const values: Record<string, string> = {
    concept: entityAnchor(link.other_slug, link.other_title),
    relation: e(link.role_title),
    rationale: e(link.justification),
  };
  const description = fields.map(f => field(f.title, values[f.slot] ?? "")).join("");
  const evidence = link.citations.map(q => evidenceHtml(q, fields)).join("");
  const role = link.role_title ? ` — ${e(link.role_title)}` : "";
  return `<details class="parameter-set-relation" data-relation-id="${e(link.id)}"><summary><strong>${e(link.other_title)}</strong>${role}</summary>` +
    (description ? `<dl>${description}</dl>` : "") +
    (evidence ? `<ul>${evidence}</ul>` : "") + "</details>";
}

/** Receives one attached set selected by UID from the public card projection. */
export function styleAttributionWidgetHtml(set: PublicRelationSet | undefined): string {
  if (!set) return "";
  const entries = set.links.map(link => attributionHtml(link, set.fields)).join("");
  return `<section class="parameter-set-relations" data-parameter-set="${e(set.id)}"><h2>${e(set.title)}</h2>` +
    (entries || '<p class="hint">Опубликованных связей пока нет.</p>') + "</section>";
}
