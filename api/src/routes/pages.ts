/**
 * Готовые страницы для поисковиков и ссылок (решение Р-65).
 *
 * Caddy отдаёт сюда все адреса сайта, которым не нашлось файла сборки.
 * Ответ — та же страница клиента, но с заполненными заголовком, описанием,
 * разметкой schema.org и основным текстом. Публичная карточка сохраняет
 * этот HTML (Р-69); приложение загружается только для интерактивных разделов
 * и рабочих экранов.
 *
 * Здесь же служебные файлы: robots.txt, sitemap.xml и ключ IndexNow.
 * Показывается только опубликованное: готовая страница строится без входа,
 * как для гостя. Черновик отвечает 404, а вошедший редактор получает тот же HTML-рендер
 * через защищённый API со своим токеном.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { sql } from "../lib/db.ts";
import { siteHeader } from "../lib/siteHeader.ts";
import { canSeeDrafts } from "../lib/auth.ts";
import { ApiError } from "../lib/errors.ts";
import { type AppEnv, log } from "../lib/http.ts";
import {
  absolute,
  citation,
  entityPath,
  escapeHtml,
  mediaUrl,
  site,
  summary,
} from "../lib/site.ts";
import {
  type CardValue,
  loadPublicCard,
  type PublicCard,
  type PublicImage,
  resolveEntity,
} from "../lib/publicCard.ts";
import { blocks as blocksHtml, figureHtml, firstParagraph } from "../lib/blocksHtml.ts";

export const pages = new Hono<AppEnv>();

// ── Шаблон страницы ──────────────────────────────────────────────────────────

let template: { mtime: number; html: string } | null = null;

/** Собранная страница клиента; перечитывается после каждой сборки. */
async function readTemplate(): Promise<string> {
  const stat = await Deno.stat(site.indexHtml);
  const mtime = stat.mtime?.getTime() ?? 0;
  if (!template || template.mtime !== mtime) {
    template = { mtime, html: await Deno.readTextFile(site.indexHtml) };
  }
  return template.html;
}

interface Page {
  status: 200 | 404;
  title: string;
  description: string;
  /** Путь канонического адреса; пусто — адрес не для поисковика. */
  canonical: string | null;
  image?: string | null;
  ogType?: "website" | "article" | "profile";
  jsonLd?: unknown[];
  body: string;
  /** Страница только для работы: в поиск её не пускаем. */
  noindex?: boolean;
  /** Чтение без запуска React и BlockNote. */
  publicReader?: boolean;
  entityKey?: string;
}

function head(page: Page): string {
  const title = escapeHtml(page.title);
  const description = escapeHtml(page.description);
  const lines = [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}" />`,
  ];
  if (page.noindex || page.status !== 200) {
    lines.push(`<meta name="robots" content="noindex, follow" />`);
  }
  if (page.canonical) {
    const url = escapeHtml(absolute(page.canonical));
    lines.push(
      `<link rel="canonical" href="${url}" />`,
      `<meta property="og:url" content="${url}" />`,
    );
  }
  lines.push(
    `<meta property="og:site_name" content="${escapeHtml(site.name)}" />`,
    `<meta property="og:locale" content="ru_RU" />`,
    `<meta property="og:type" content="${page.ogType ?? "website"}" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
  );
  if (page.image) {
    lines.push(
      `<meta property="og:image" content="${escapeHtml(page.image)}" />`,
      `<meta name="twitter:card" content="summary_large_image" />`,
    );
  }
  for (const data of page.jsonLd ?? []) {
    // «</» внутри строки закрыл бы тег скрипта раньше времени.
    const json = JSON.stringify(data).replaceAll("</", "<\\/");
    lines.push(`<script type="application/ld+json">${json}</script>`);
  }
  return lines.join("\n    ");
}

async function render(c: Context<AppEnv>, page: Page) {
  let html: string;
  try {
    html = await readTemplate();
  } catch (error) {
    // Без собранной страницы клиента отдавать нечего: пусть это будет видно
    // в журнале и в прогоне, а не белым экраном у читателя.
    log("error", c.get("requestId"), "нет шаблона страницы", {
      path: site.indexHtml,
      error: error instanceof Error ? error.message : String(error),
    });
    return c.text("Сайт обновляется, зайдите через минуту.", 503);
  }
  // Сначала убираем описание шаблона, потом ставим своё: в обратном порядке
  // уходило бы наше.
  const out = html
    .replace(/<meta name="description"[^>]*>\s*/, "")
    .replace(/<title>[\s\S]*?<\/title>/, head(page))
    .replace(
      '<div id="root"></div>',
      `<div id="root"><div class="ssr"${page.publicReader ? ' data-public-page="true"' : ""}${page.entityKey ? ` data-entity-key="${escapeHtml(page.entityKey)}"` : ""}>${page.body}</div></div>`,
    );
  c.header("cache-control", "no-cache");
  c.header("content-type", "text/html; charset=utf-8");
  return c.body(out, page.status);
}

// ── Общие куски ──────────────────────────────────────────────────────────────

function layout(inner: string): string {
  return `<div class="shell"><header class="top" data-site-header>${siteHeader(null, "")}</header><main>${inner}</main></div>`;
}

// Оба клиента получают один и тот же элемент меню и ту же модель прав.
pages.get("/api/v1/site-header", (c) => {
  c.header("cache-control", "private, no-store");
  const principal = c.get("principal");
  return c.json({
    html: siteHeader(principal, c.req.query("path") ?? "/"),
    viewer: { authenticated: !!principal, displayName: principal?.displayName ?? "Гость",
      permissions: principal ? [...principal.permissions] : [] },
  });
});

const WEBSITE = {
  "@type": "WebSite",
  "@id": `${site.url}/#website`,
  name: site.name,
  url: `${site.url}/`,
  inLanguage: "ru",
  description: site.description,
};

// ── Списки ───────────────────────────────────────────────────────────────────

interface ListRow {
  slug: string;
  title_ru: string;
  type_title: string;
}

async function publishedIn(branch: string | null): Promise<ListRow[]> {
  return await sql<ListRow>`
    select e.slug, e.title_ru, ty.title_ru as type_title
      from app.entities e
      join app.entity_types ty on ty.id = e.type_id
     where e.is_published
       and ((${branch}::text is not null and e.type_id in
             (select app.entity_type_subtree(${branch})))
            or (${branch}::text is null and e.type_id not in
             (select app.entity_type_subtree('project_pages'))))
     order by e.title_ru
     limit 2000
  `;
}

function listHtml(rows: ListRow[], showType = true): string {
  if (rows.length === 0) return `<p>Опубликованных записей пока нет.</p>`;
  return `<ul>${
    rows.map((row) =>
      `<li><a href="${escapeHtml(entityPath(row.slug))}">${escapeHtml(row.title_ru)}</a>` +
      (showType ? ` — ${escapeHtml(row.type_title)}` : "") + `</li>`
    ).join("")
  }</ul>`;
}

function listLd(path: string, title: string, rows: ListRow[]) {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: title,
    url: absolute(path),
    inLanguage: "ru",
    isPartOf: { "@id": WEBSITE["@id"] },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: rows.length,
      itemListElement: rows.slice(0, 500).map((row, index) => ({
        "@type": "ListItem",
        position: index + 1,
        url: absolute(entityPath(row.slug)),
        name: row.title_ru,
      })),
    },
  };
}

const SECTIONS: Record<string, { branch: string; title: string; lead: string }> = {
  "/objects": {
    branch: "what",
    title: "Проекты",
    lead: "Построенное и оставшееся на бумаге: смотрим на расчёт, чертёж и стремление.",
  },
  "/authors": { branch: "who", title: "Авторы", lead: "Люди, бюро и коллективы." },
  "/lectures": {
    branch: "learning",
    title: "Лекции",
    lead: "Лекции курса «Квантовая архитектура» со ссылками на объекты и авторов.",
  },
};

pages.get("/", async (c) => {
  const [what, who, learning] = await Promise.all([
    publishedIn("what"),
    publishedIn("who"),
    publishedIn("learning"),
  ]);
  const all = [...what, ...who, ...learning];
  const body = layout(
    `<h1>${escapeHtml(site.name)}</h1><p>${escapeHtml(site.description)}</p>` +
      `<h2><a href="/objects">Проекты</a></h2>${listHtml(what)}` +
      `<h2><a href="/authors">Авторы</a></h2>${listHtml(who)}` +
      `<h2><a href="/lectures">Лекции</a></h2>${listHtml(learning)}`,
  );
  return await render(c, {
    status: 200,
    title: `${site.name} — курс «Квантовая архитектура»`,
    description: site.description,
    canonical: "/",
    jsonLd: [{ "@context": "https://schema.org", ...WEBSITE }, listLd("/", site.name, all)],
    body,
  });
});

for (const [path, section] of Object.entries(SECTIONS)) {
  pages.get(path, async (c) => {
    const rows = await publishedIn(section.branch);
    return await render(c, {
      status: 200,
      title: `${section.title} — ${site.name}`,
      description: section.lead,
      canonical: path,
      jsonLd: [listLd(path, section.title, rows)],
      body: layout(`<h1>${section.title}</h1><p>${escapeHtml(section.lead)}</p>${listHtml(rows)}`),
    });
  });
}

// ── О проекте ────────────────────────────────────────────────────────────────

/** Тексты «О проекте» — сущности с документом-описанием; прежние адреса сохранены. */
const ABOUT_ALIASES: Record<string, string> = {
  logo: "about-logo",
  philosophy: "about-philosophy",
  manifest: "about-manifest",
  feedback: "about-feedback",
};

pages.get("/about", async (c) => {
  const rows = await publishedIn("project_pages");
  const title = "О проекте";
  const lead = "Зачем создан 2ВХУТЕМАС, как устроен атлас и как связаться с проектом.";
  return await render(c, {
    status: 200,
    title: `${title} — ${site.name}`,
    description: lead,
    canonical: "/about",
    jsonLd: [listLd("/about", title, rows)],
    body: layout(`<h1>${title}</h1><p>${escapeHtml(lead)}</p>${listHtml(rows, false)}`),
  });
});

pages.get("/about/logo/tool", (c) => {
  c.header("location", entityPath(ABOUT_ALIASES.logo));
  c.header("cache-control", "public, max-age=3600");
  return c.body(null, 301);
});
pages.get("/about/:section", async (c) => {
  const slug = ABOUT_ALIASES[c.req.param("section")];
  if (!slug) return await notFound(c);
  c.header("location", entityPath(slug));
  c.header("cache-control", "public, max-age=3600");
  return c.body(null, 301);
});

// ── Запись ───────────────────────────────────────────────────────────────────

/** Величина в человеческом виде — так же, как её пишет карточка клиента. */
function valueText(value: CardValue): string {
  if (value.num_value !== null && value.num_value !== undefined && value.num_value !== "") {
    return `${value.num_value}${value.unit ? " " + value.unit : ""}`;
  }
  if (value.text_value) return value.text_value;
  if (value.bool_value !== null && value.bool_value !== undefined) {
    return value.bool_value ? "да" : "нет";
  }
  if (value.option_title) return value.option_title;
  if (value.place) return placeText(value.place);
  if (value.date_start_year) {
    const range = value.date_end_year
      ? `${value.date_start_year}–${value.date_end_year}`
      : value.is_ongoing
      ? `с ${value.date_start_year}`
      : String(value.date_start_year);
    return value.is_approximate ? `около ${range}` : range;
  }
  return "";
}

function placeText(place: Record<string, unknown>): string {
  const parts = ["country", "settlement", "street", "house", "unit"]
    .map(key => place[key])
    .filter((part): part is string => typeof part === "string" && part.trim() !== "");
  if (parts.length) return parts.join(", ");
  return place.lat !== null && place.lat !== undefined && place.lon !== null && place.lon !== undefined
    ? `${place.lat}, ${place.lon}` : "место без сведений";
}

/** Год как дата schema.org: «около» и диапазоны не изображаем точнее, чем знаем. */
function year(value: CardValue | undefined): string | undefined {
  return value?.date_start_year ? String(value.date_start_year) : undefined;
}

/** Ссылки на ту же вещь в Wikidata и Википедии: так поисковик узнаёт сущность. */
function sameAs(card: PublicCard): string[] {
  return card.sources
    .map((s) => s.url ?? "")
    .filter((url) => /^https?:\/\/([a-z-]+\.)?(wikidata\.org|wikipedia\.org)\//i.test(url));
}

const PLACE_TYPES = new Set(["architecture_object", "environment_object"]);
const WORK_TYPES: Record<string, string> = {
  book: "Book",
  article: "Article",
  film: "Movie",
  music: "MusicComposition",
  performance: "CreativeWork",
  competition_entry: "CreativeWork",
  study_work: "CreativeWork",
  urban_concept: "CreativeWork",
  theory_concept: "CreativeWork",
  memorandum: "CreativeWork",
};

function schemaTypes(card: PublicCard): string[] {
  const codes = card.type_path.map((t) => t.code);
  const root = codes[0];
  if (root === "who") {
    return codes.includes("company") || codes.includes("group") ? ["Organization"] : ["Person"];
  }
  if (root === "learning") return ["LearningResource"];
  if (root === "when") return ["Thing"];
  if (codes.some((code) => PLACE_TYPES.has(code))) {
    // Здание — одновременно место и произведение: у места есть адрес,
    // у произведения — автор и дата создания.
    return ["LandmarksOrHistoricalBuildings", "CreativeWork"];
  }
  if (codes.includes("event")) return ["Event"];
  for (const code of codes) if (WORK_TYPES[code]) return [WORK_TYPES[code]];
  return ["CreativeWork"];
}

function imageLd(image: PublicImage) {
  const data: Record<string, unknown> = {
    "@type": "ImageObject",
    contentUrl: mediaUrl(image.asset_id),
    url: mediaUrl(image.asset_id),
  };
  if (image.caption) data.caption = image.caption;
  if (image.author) {
    data.creator = { "@type": "Person", name: image.author };
    data.creditText = image.author;
  }
  if (image.source_url && /^https?:/i.test(image.source_url)) data.isBasedOn = image.source_url;
  else if (image.source) data.isBasedOn = image.source;
  return data;
}

const CREATOR_ROLES = new Set(["architect", "engineer", "author"]);

function cardLd(card: PublicCard, description: string, authors: string[]) {
  const types = schemaTypes(card);
  const url = absolute(entityPath(card.slug));
  const byParam = (code: string) => card.values.find((v) => v.parameter === code);
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": types.length === 1 ? types[0] : types,
    "@id": `${url}#entity`,
    name: card.title_ru,
    url,
    identifier: String(card.id),
    inLanguage: "ru",
    isPartOf: { "@id": WEBSITE["@id"] },
    dateModified: new Date(card.modified_at).toISOString(),
  };
  const alternate = [card.title_original, card.title_en, card.title_la].filter(Boolean);
  if (alternate.length > 0) data.alternateName = alternate;
  if (description) data.description = description;
  // Картинка в разметке несёт ту же подпись, что и на странице (Р-68):
  // поисковик, показывая её, знает, кому она принадлежит и откуда взята.
  if (card.media[0]) data.image = card.media.slice(0, 5).map(imageLd);
  if (card.published_at) data.datePublished = new Date(card.published_at).toISOString();
  const links = sameAs(card);
  if (links.length > 0) data.sameAs = links;
  if (card.tags.length > 0) data.keywords = card.tags.join(", ");

  const creators = card.links
    .filter((l) => l.role && CREATOR_ROLES.has(l.role) && l.other_root === "who")
    .map((l) => ({ "@type": "Person", name: l.other_title, url: absolute(entityPath(l.other_slug)) }));

  if (types.includes("Person") || types.includes("Organization")) {
    if (types.includes("Person")) {
      data.birthDate = year(byParam("birth"));
      data.deathDate = year(byParam("death"));
      const birthplace = byParam("birthplace")?.place;
      if (birthplace) data.birthPlace = { "@type": "Place", name: placeText(birthplace) };
    } else {
      data.foundingDate = year(byParam("founded"));
      data.dissolutionDate = year(byParam("dissolved"));
    }
    // Работы автора — связи, в которых он выступает архитектором или автором.
    const works = card.links
      .filter((l) => l.role && CREATOR_ROLES.has(l.role) && l.other_root === "what")
      .map((l) => ({ "@type": "CreativeWork", name: l.other_title, url: absolute(entityPath(l.other_slug)) }));
    if (works.length > 0) data.subjectOf = works;
  } else if (types.includes("LearningResource")) {
    data.learningResourceType = "лекция";
    data.educationalLevel = "высшее образование";
    if (authors.length > 0) data.author = authors.map((name) => ({ "@type": "Person", name }));
    const course = byParam("course")?.text_value;
    if (course) data.isPartOf = [{ "@id": WEBSITE["@id"] }, { "@type": "Course", name: course }];
    const number = byParam("lecture_number")?.num_value;
    if (number !== undefined && number !== null) data.position = Number(number);
    const about = card.links.map((l) => ({ "@type": "Thing", name: l.other_title, url: absolute(entityPath(l.other_slug)) }));
    if (about.length > 0) data.about = about;
  } else if (types[0] !== "Thing") {
    if (creators.length > 0) data.creator = creators;
    data.dateCreated = year(byParam("opening") ?? byParam("publication") ?? byParam("design"));
    const address = byParam("address")?.place;
    if (address && types.includes("LandmarksOrHistoricalBuildings")) {
      data.address = placeText(address);
      const lat = Number(address.lat);
      const lon = Number(address.lon);
      if (address.lat !== null && Number.isFinite(lat) && Number.isFinite(lon)) {
        data.geo = { "@type": "GeoCoordinates", latitude: lat, longitude: lon };
      }
    }
  }
  for (const key of Object.keys(data)) if (data[key] === undefined) delete data[key];
  return data;
}

function breadcrumbsLd(card: PublicCard) {
  const root = card.type_path[0]?.code;
  const section = root === "who"
    ? ["/authors", "Авторы"]
    : root === "learning"
    ? ["/lectures", "Лекции"]
    : root === "project_pages" ? ["/about", "О проекте"]
    : ["/objects", "Проекты"];
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: site.name, item: `${site.url}/` },
      { "@type": "ListItem", position: 2, name: section[1], item: absolute(section[0]) },
      { "@type": "ListItem", position: 3, name: card.title_ru, item: absolute(entityPath(card.slug)) },
    ],
  };
}

function cardBody(card: PublicCard, descriptionHtml: string, cite: ReturnType<typeof citation>) {
  const e = escapeHtml;
  const parts: string[] = [];
  const editPath = `/entities/${card.id}/edit`;
  parts.push(`<article class="public-card">`, `<h1>${e(card.title_ru)}<span class="reader-actions" data-reader-edit data-href="${e(editPath)}" hidden></span></h1>`);
  const alternate = [card.title_original, card.title_en, card.title_la].filter(Boolean);
  if (alternate.length > 0) parts.push(`<p class="sub">${e(alternate.join(" · "))}</p>`);
  const place = card.values.find(v => v.place)?.place;
  parts.push(`<div class="row reader-meta"><span class="badge">${e(card.type_title)}</span>` +
    `<span class="badge">${card.is_published ? "опубликовано" : "черновик"}</span>` +
    [place?.settlement, place?.country].filter(Boolean).map(v => `<span class="badge">${e(v)}</span>`).join("") +
    `</div>`);
  if (card.tags.length > 0) parts.push(`<p class="tags-line">${card.tags.map(t => `<span class="tag-chip">#${e(t)}</span>`).join(" ")}</p>`);

  const groups = new Map<number, CardValue[]>();
  for (const value of card.values) {
    if (!groups.has(value.indicator_id)) groups.set(value.indicator_id, []);
    groups.get(value.indicator_id)!.push(value);
  }
  for (const values of groups.values()) {
    const group = values[0];
    if (groups.size > 1 || !group.is_current) parts.push(`<h2>${e(group.indicator_title)}${group.measured_year ? ` · ${group.measured_year}` : ""}${group.is_current ? "" : " · не действующие"}</h2>`);
    for (const [title, rows] of [
      ["Показатели", values.filter(v => v.value_type !== "place" && v.value_type !== "date")],
      ["Места", values.filter(v => v.value_type === "place")],
      ["Датировки", values.filter(v => v.value_type === "date")],
    ] as [string, CardValue[]][]) {
      if (rows.length) parts.push(`<h2>${title}</h2><dl>${rows.map(v => `<dt>${e(v.title)}</dt><dd>${e(valueText(v))}</dd>`).join("")}</dl>`);
    }
  }

  if (card.links.length > 0) {
    // Обоснование связи — наш собственный текст, которого нет в энциклопедиях.
    // Выводим его открыто, рядом со ссылкой, а не прячем в интерфейсе.
    parts.push(
      `<h2>Связи</h2><ul class="relations">${
        card.links.map((l) =>
          `<li><a href="${e(entityPath(l.other_slug))}">${e(l.other_title)}</a>` +
          (l.role_title ? ` (${e(l.role_title)})` : "") +
          (l.justification ? `<p>${e(l.justification)}</p>` : "") + `</li>`
        ).join("")
      }</ul>`,
    );
  }

  if (descriptionHtml) parts.push(`<h2>Описание</h2><div class="public-document">${descriptionHtml}</div>`);

  if (card.media.length > 0) {
    parts.push(
      `<h2>Изображения</h2><div class="public-gallery">${
        // Изображение — цитата (Р-68): под каждым автор и источник.
        card.media.map((m) =>
          figureHtml(mediaUrl(m.asset_id, "thumbnail"), m.caption ?? card.title_ru, m)
        ).join("")
      }</div>`,
    );
  }

  if (card.sources.length > 0) {
    parts.push(
      `<h2>Источники</h2><ul>${
        card.sources.map((s) => {
          const label = e(s.title || s.text || s.url || s.kind_title) + (s.year ? `, ${s.year}` : "");
          return s.url && /^https?:/i.test(s.url)
            ? `<li><a href="${e(s.url)}" rel="noopener">${label}</a></li>`
            : `<li>${label}</li>`;
        }).join("")
      }</ul>`,
    );
  }

  const mentions = card.mentions.filter((m) => m.owner_slug);
  if (mentions.length > 0) {
    parts.push(
      `<h2>Упоминается в материалах</h2><ul>${
        mentions.map((m) =>
          `<li><a href="${e(entityPath(m.owner_slug!))}">${e(m.owner_title ?? m.document_title ?? "")}</a></li>`
        ).join("")
      }</ul>`,
    );
  }

  parts.push(
    `<details class="cite-disclosure"><summary>Цитировать</summary><h2>Как цитировать</h2>`,
    `<p><b>ГОСТ Р 7.0.100–2018:</b> <span id="cite-gost">${e(cite.gost)}</span></p><button type="button" class="ghost" data-copy="cite-gost">Скопировать ГОСТ</button>`,
    `<p><b>APA:</b> <span id="cite-apa">${e(cite.apa)}</span></p><button type="button" class="ghost" data-copy="cite-apa">Скопировать APA</button>`,
    `<p>Постоянная ссылка: <a href="${e(cite.url)}">${e(cite.url)}</a></p>`,
    `</details></article>`,
  );
  return parts.join("");
}

pages.get("/entities/:key", async (c) => {
  const key = c.req.param("key");
  if (key === "new") return await appOnly(c, "Новая запись");
  const found = await resolveEntity(key);
  // Черновик для гостя не существует: 404, и прежний номер не выдаёт его слаг.
  if (!found || !found.isPublished) return await notFound(c, key);
  if (found.moved || found.slug !== key) {
    return c.redirect(entityPath(found.slug), 301);
  }
  const card = await loadPublicCard(found.id);
  if (!card) return await notFound(c, key);

  const ctx = { entities: card.refs, publicAssets: card.publicAssets };
  const descriptionHtml = card.document ? blocksHtml(card.document.body_json, ctx) : "";
  const lead = card.document ? firstParagraph(card.document.body_json) : "";
  const description = summary(lead) ||
    summary([card.type_title, ...card.values.slice(0, 4).map((v) => `${v.title}: ${valueText(v)}`)]
      .join(". "));
  const yearOf = new Date(card.modified_at).getFullYear();
  const cite = citation({ title: card.title_ru, slug: card.slug, authors: card.authors, year: yearOf });
  const root = card.type_path[0]?.code;

  return await render(c, {
    status: 200,
    title: `${card.title_ru} — ${site.name}`,
    description,
    canonical: entityPath(card.slug),
    image: card.media[0] ? mediaUrl(card.media[0].asset_id) : null,
    ogType: root === "who" ? "profile" : "article",
    jsonLd: [cardLd(card, description, card.authors), breadcrumbsLd(card)],
    publicReader: true,
    entityKey: String(card.id),
    body: layout(cardBody(card, descriptionHtml, cite)),
  });
});

// Тот же рендер для просмотра черновиков: авторизация общая для /api/v1/*.
// Ответ не кэшируется; гость не получает ни названия, ни адреса черновика.
pages.get("/api/v1/entities/:key/card", async (c) => {
  c.header("cache-control", "private, no-store");
  const principal = c.get("principal");
  const found = await resolveEntity(c.req.param("key"));
  if (!found || (!found.isPublished && !canSeeDrafts(principal))) {
    throw new ApiError("not_found", "Сущность не найдена");
  }
  const card = await loadPublicCard(found.id, principal);
  if (!card) throw new ApiError("not_found", "Сущность не найдена");
  const description = card.document ? blocksHtml(card.document.body_json, {
    entities: card.refs, publicAssets: card.publicAssets,
  }) : "";
  const cite = citation({ title: card.title_ru, slug: card.slug, authors: card.authors,
    year: new Date(card.modified_at).getFullYear() });
  return c.json({ html: cardBody(card, description, cite), title: `${card.title_ru} — ${site.name}`,
    path: entityPath(card.slug) });
});

pages.get("/entities/:key/edit", (c) => appOnly(c, "Правка записи"));

// ── Служебные файлы ──────────────────────────────────────────────────────────

pages.get("/robots.txt", (c) => {
  // Файлы медиатеки открыты: без них поисковик не покажет картинку
  // и не возьмёт обложку в выдачу. Остальное API поисковику не нужно.
  const body = [
    "User-agent: *",
    "Allow: /api/v1/media/",
    "Disallow: /api/",
    "Disallow: /login",
    "Disallow: /entities/new",
    "Disallow: /entities/*/edit",
    "Disallow: /media",
    "Disallow: /parameters",

    // /old/ не закрываем здесь: запрет обхода помешал бы поисковику увидеть
    // noindex, который Caddy ставит прежнему сайту, и старые страницы
    // остались бы в выдаче голыми адресами.
    "",
    `Sitemap: ${site.url}/sitemap.xml`,
    "",
  ].join("\n");
  c.header("cache-control", "public, max-age=3600");
  return c.text(body);
});

pages.get("/sitemap.xml", async (c) => {
  const rows = await sql<{ slug: string; modified_at: string }>`
    select e.slug,
           greatest(e.updated_at,
                    (select max(r.created_at) from app.revisions r where r.material_id = m.id),
                    (select max(d.updated_at) from app.attachments a
                       join app.targets t on t.id = a.target_id
                       join app.documents d on d.id = a.document_id
                      where t.entity_id = e.id)) as modified_at
      from app.entities e
      left join app.materials m on m.entity_id = e.id
     where e.is_published
     order by e.id
  `;
  const newest = rows.reduce(
    (max, row) => Math.max(max, new Date(row.modified_at).getTime()),
    0,
  );
  const lastmod = (time: number) => new Date(time).toISOString().slice(0, 10);
  const statics = ["/", "/objects", "/authors", "/lectures", "/about"].map((path) =>
    `<url><loc>${escapeHtml(absolute(path))}</loc>${
      newest ? `<lastmod>${lastmod(newest)}</lastmod>` : ""
    }</url>`
  );
  const entries = rows.map((row) =>
    `<url><loc>${escapeHtml(absolute(entityPath(row.slug)))}</loc>` +
    `<lastmod>${lastmod(new Date(row.modified_at).getTime())}</lastmod></url>`
  );
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    [...statics, ...entries].join("\n") + `\n</urlset>\n`;
  c.header("content-type", "application/xml; charset=utf-8");
  c.header("cache-control", "public, max-age=600");
  return c.body(xml);
});

// ── Прочее ───────────────────────────────────────────────────────────────────

/** Рабочие экраны: страница клиента без содержимого и вне поиска. */
function appOnly(c: Context<AppEnv>, title: string) {
  return render(c, {
    status: 200,
    title: `${title} — ${site.name}`,
    description: site.description,
    canonical: null,
    noindex: true,
    body: "",
  });
}

for (const path of ["/login", "/media", "/media/*", "/parameters"]) {
  const title = path === "/login" ? "Вход" : path === "/parameters" ? "Параметры" : "Медиатека";
  pages.get(path, (c) => appOnly(c, title));
}

async function notFound(c: Context<AppEnv>, entityKey?: string) {
  return await render(c, {
    status: 404,
    title: `Страница не найдена — ${site.name}`,
    publicReader: !!entityKey,
    entityKey,
    description: "Такой страницы нет. Возможно, запись ещё не опубликована или адрес набран с ошибкой.",
    canonical: null,
    body: layout(
      `<h1>Страница не найдена</h1><p>Такой страницы нет. Возможно, запись ещё не опубликована ` +
        `или адрес набран с ошибкой.</p><p><a href="/">На главную</a></p>`,
    ),
  });
}

pages.get("*", (c) => {
  // Неизвестный маршрут API — ответ API, а не страница сайта.
  if (c.req.path.startsWith("/api/")) {
    return c.json({
      error: {
        code: "not_found",
        message: "Маршрут не найден",
        details: null,
        request_id: c.get("requestId") ?? "unknown",
      },
    }, 404);
  }
  // Файл ключа IndexNow: по нему поисковик проверяет, что уведомление от нас.
  if (site.indexNowKey && c.req.path === `/${site.indexNowKey}.txt`) {
    return c.text(site.indexNowKey);
  }
  return notFound(c);
});

// ── IndexNow ─────────────────────────────────────────────────────────────────

/**
 * Сообщить Яндексу (и через общий протокол — Bing) об изменившихся адресах.
 * Уведомление не держит публикацию: ошибка пишется в журнал и только.
 */
export function notifyIndexNow(requestId: string, paths: string[]) {
  if (!site.indexNowKey || paths.length === 0) return;
  const host = new URL(site.url).host;
  fetch("https://yandex.com/indexnow", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      host,
      key: site.indexNowKey,
      keyLocation: `${site.url}/${site.indexNowKey}.txt`,
      urlList: paths.map(absolute),
    }),
    signal: AbortSignal.timeout(10_000),
  }).then((response) => {
    log(response.ok ? "info" : "warn", requestId, "indexnow", { status: response.status, paths });
  }).catch((error) => {
    log("warn", requestId, "indexnow не доставлен", {
      error: error instanceof Error ? error.message : String(error),
      paths,
    });
  });
}
