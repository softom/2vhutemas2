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
import { entities } from "./entities.ts";
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
import {
  blocks as blocksHtml,
  type CompactItem,
  compactLine,
  compactParts,
  compactPicture,
  figureHtml,
  SOURCE_MARK,
  firstParagraph,
} from "../lib/blocksHtml.ts";

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
  /** Каталог: страница во всю ширину приложения, как его собственный каталог. */
  catalog?: boolean;
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
      `<div id="root"><div class="ssr"${page.publicReader ? ' data-public-page="true"' : ""}${page.catalog ? ' data-catalog="true"' : ""}${page.entityKey ? ` data-entity-key="${escapeHtml(page.entityKey)}"` : ""}>${page.body}</div></div>`,
    );
  c.header("cache-control", "no-cache");
  c.header("content-type", "text/html; charset=utf-8");
  return c.body(out, page.status);
}

// ── Общие куски ──────────────────────────────────────────────────────────────

/** Красная лента знака проходит через всю страницу, от шапки до формулы в футере (Р-91). */
export const SITE_FOOTER = `<footer class="site-foot"><div class="foot-axis"><span>Искусство</span><span class="eq">=</span><span>Вх<sup>2</sup>·м</span></div>` +
  `<div class="foot-line"><span>2vhutemas · курс квантовой архитектуры</span><span>Прежний сайт — <a href="/old/">2vhutemas.ru/old</a></span></div></footer>`;

function layout(inner: string): string {
  return `<div class="shell"><div class="through" aria-hidden="true"></div><div class="through-marks" aria-hidden="true"></div>` +
    `<header class="top" data-site-header>${siteHeader(null, "")}</header><main>${inner}</main>${SITE_FOOTER}</div>`;
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
  title_en: string | null;
  type_title: string;
  compact: CompactItem[];
}

async function publishedIn(branch: string | null): Promise<ListRow[]> {
  return await sql<ListRow>`
    select e.slug, e.title_ru, e.title_en, ty.title_ru as type_title,
           app.compact_json(e.id, false) as compact
      from app.read_entities(false) e
      join app.entity_types ty on ty.id = e.type_id
     where e.is_published
       and ((${branch}::text is not null and e.type_id in
             (select app.entity_type_subtree(${branch})))
            or (${branch}::text is null and e.type_id not in
             (select app.entity_type_subtree('project_pages')
              union select app.entity_type_subtree('materials'))))
     order by e.title_ru
     limit 2000
  `;
}

function listHtml(rows: ListRow[], showType = true): string {
  if (rows.length === 0) return `<p>Опубликованных записей пока нет.</p>`;
  return `<ul>${
    rows.map((row) =>
      // Строка списка — компактный вид записи, тот же, что в тексте.
      `<li>${compactLine({ slug: row.slug, title: row.title_ru, compact: row.compact })}` +
      (showType ? ` — ${escapeHtml(row.type_title)}` : "") + `</li>`
    ).join("")
  }</ul>`;
}

interface CatalogItem {
  slug: string;
  title_ru: string;
  title_en: string | null;
  type_title: string | null;
  material_status: string | null;
  compact?: CompactItem[];
}

interface CatalogPage {
  items: CatalogItem[];
  next_cursor: string | null;
}

/**
 * Первая страница каталога — тот же ответ, что получает приложение
 * (`GET /api/v1/entities`): те же записи, в том же порядке, столько же.
 */
async function firstCatalogPage(branch: string | null): Promise<CatalogPage> {
  const response = await entities.request(branch ? `/?type=${encodeURIComponent(branch)}` : "/");
  return await response.json() as CatalogPage;
}

function plural(count: number, [one, few, many]: [string, string, string]): string {
  const tens = count % 100;
  if (tens >= 11 && tens <= 14) return many;
  const ones = count % 10;
  if (ones === 1) return one;
  if (ones >= 2 && ones <= 4) return few;
  return many;
}

/** Счётчик списка — как ListCount в приложении. */
function listCountHtml(shown: number, hasMore: boolean): string {
  return `<div class="list-count"><span class="hint">Показано ${shown} ${plural(shown, ["запись", "записи", "записей"])}` +
    `${hasMore ? " — есть ещё" : ""}</span>` +
    (hasMore ? `<button type="button" class="ghost">Показать ещё</button>` : "") + `</div>`;
}

interface TypeChip {
  code: string;
  title_ru: string;
}

/**
 * Быстрый отбор над плашками — ближайшие ветви раздела, как в приложении
 * (Catalog.tsx): кнопки видны сразу, без ожидания клиента.
 */
async function typeChips(branch: string | null): Promise<TypeChip[]> {
  return await sql<TypeChip>`
    select ty.code, ty.title_ru
      from app.entity_types ty
     where (${branch}::text is null and ty.parent_id is null
            and ty.code not in ('project_pages', 'materials'))
        or ty.parent_id = (select p.id from app.entity_types p where p.code = ${branch})
     order by ty.sort_order, ty.title_ru
  `;
}

function chipsHtml(chips: TypeChip[], allLabel: string): string {
  // До загрузки клиента кнопки держат место и показывают выбор «всё».
  return `<div class="type-chips" role="group" aria-label="Тип записи">` +
    `<button type="button" class="on" aria-pressed="true" disabled>${escapeHtml(allLabel)}</button>` +
    chips.map((chip) => `<button type="button" aria-pressed="false" disabled>${escapeHtml(chip.title_ru)}</button>`).join("") +
    `</div>`;
}

/**
 * Каталог раздела той же разметкой и с теми же данными, что каталог
 * приложения (Catalog.tsx): карточки по компактному виду типа. Данные
 * вложены в страницу, и приложение начинает с них, — поэтому при загрузке
 * клиента ничего не мигает и не перестраивается.
 */
function catalogHtml(title: string, lead: string, page: CatalogPage, branch: string | null, typeLabel: string, chips: TypeChip[] = []): string {
  const cards = page.items.map((row) => {
    const view = compactParts(row.compact);
    const url = compactPicture(view, "thumbnail");
    const picture = !view.picture ? "" : url
      ? `<img src="${escapeHtml(url)}" alt="" loading="lazy" />`
      : `<div class="card-no-cover">без изображения</div>`;
    return `<a class="card${view.portrait ? " portrait" : ""}" href="${escapeHtml(entityPath(row.slug))}">${picture}` +
      `<div class="kind">${escapeHtml(row.type_title ?? "")}</div>` +
      `<div class="title">${view.mark ? SOURCE_MARK : ""}${escapeHtml(row.title_ru)}</div>` +
      (view.params.length ? `<div class="kind">${escapeHtml(view.params.join(", "))}</div>` : "") +
      (row.title_en ? `<div class="kind">${escapeHtml(row.title_en)}</div>` : "") +
      `<div style="margin-top:8px"><span class="badge status${row.material_status === "published" ? "" : " draft"}">${row.material_status === "published" ? "опубликовано" : "черновик"}</span></div></a>`;
  }).join("");
  // Поиск и отбор работают в приложении; здесь они держат место.
  const filters = `<div class="filters"><input placeholder="Поиск по названию" disabled />` +
    `<select disabled><option>${escapeHtml(typeLabel)}</option></select></div>`;
  // «</» внутри строки закрыл бы тег скрипта раньше времени.
  const data = JSON.stringify({ branch: branch ?? "", page, chips }).replaceAll("</", "<\\/");
  const count = listCountHtml(page.items.length, !!page.next_cursor);
  return `<script type="application/json" id="catalog-initial">${data}</script>` +
    `<section><div class="catalog-head"><h1>${escapeHtml(title)}</h1><p class="sub">${escapeHtml(lead)}</p></div>` +
    `${chipsHtml(chips, branch ? "Все в разделе" : "Все")}${filters}${count}` +
    (page.items.length ? `<div class="grid">${cards}</div>${count}` : "") + `</section>`;
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
  // Главная в приложении — общий каталог «Всё»; сервер отдаёт его же.
  const [all, first, chips] = await Promise.all([publishedIn(null), firstCatalogPage(null), typeChips(null)]);
  const body = layout(catalogHtml(
    "Всё",
    "Все записи подряд: объекты, авторы, периоды и служебные материалы.",
    first,
    null,
    "Все типы",
    chips,
  ));
  return await render(c, {
    catalog: true,
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
    const [rows, first, chips] = await Promise.all([
      publishedIn(section.branch),
      section.branch === "learning" ? Promise.resolve(null) : firstCatalogPage(section.branch),
      typeChips(section.branch),
    ]);
    return await render(c, {
      status: 200,
      title: `${section.title} — ${site.name}`,
      description: section.lead,
      canonical: path,
      jsonLd: [listLd(path, section.title, rows)],
      // Проекты и авторы в приложении — каталог раздела; лекции — своя таблица.
      catalog: section.branch !== "learning",
      body: layout(section.branch === "learning"
        ? `<h1>${section.title}</h1><p>${escapeHtml(section.lead)}</p>${listHtml(rows)}`
        : catalogHtml(section.title, section.lead, first!, section.branch, "Все в разделе", chips)),
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
  const [rows, first, chips] = await Promise.all([publishedIn("project_pages"), firstCatalogPage("project_pages"), typeChips("project_pages")]);
  const title = "О проекте";
  const lead = "Зачем создан 2ВХУТЕМАС, как устроен атлас и как связаться с проектом.";
  return await render(c, {
    status: 200,
    title: `${title} — ${site.name}`,
    description: lead,
    canonical: "/about",
    jsonLd: [listLd("/about", title, rows)],
    catalog: true,
    body: layout(catalogHtml(title, lead, first, "project_pages", "Все в разделе", chips)),
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
  parts.push(`<article class="public-card">`, `<header class="pc-head">`, `<h1>${e(card.title_ru)}<span class="reader-actions" data-reader-edit data-href="${e(editPath)}" hidden></span></h1>`);
  const alternate = [card.title_original, card.title_en, card.title_la].filter(Boolean);
  if (alternate.length > 0) parts.push(`<p class="sub">${e(alternate.join(" · "))}</p>`);
  const place = card.values.find(v => v.place)?.place;
  parts.push(`<div class="row reader-meta"><span class="badge">${e(card.type_title)}</span>` +
    `<span class="badge">${card.is_published ? "опубликовано" : "черновик"}</span>` +
    [place?.settlement, place?.country].filter(Boolean).map(v => `<span class="badge">${e(v)}</span>`).join("") +
    `</div>`);
  if (card.tags.length > 0) parts.push(`<p class="tags-line">${card.tags.map(t => `<span class="tag-chip">#${e(t)}</span>`).join(" ")}</p>`);
  parts.push(`</header>`);

  // Разделы карточки идут в порядке, который задаёт тип в таблице
  // отображений (схема данных, раздел 6). Код знает, как нарисовать каждый
  // раздел, но не решает, какие и в каком порядке.
  const sections: Record<string, () => string> = {
    indicators: () => {
      const out: string[] = [];
      const groups = new Map<number, CardValue[]>();
      for (const value of card.values) {
        if (!groups.has(value.indicator_id)) groups.set(value.indicator_id, []);
        groups.get(value.indicator_id)!.push(value);
      }
      for (const values of groups.values()) {
        const group = values[0];
        if (groups.size > 1 || !group.is_current) out.push(`<h2>${e(group.indicator_title)}${group.measured_year ? ` · ${group.measured_year}` : ""}${group.is_current ? "" : " · не действующие"}</h2>`);
        for (const [title, rows] of [
          ["Показатели", values.filter(v => v.value_type !== "place" && v.value_type !== "date")],
          ["Места", values.filter(v => v.value_type === "place")],
          ["Датировки", values.filter(v => v.value_type === "date")],
        ] as [string, CardValue[]][]) {
          if (rows.length) {
            out.push(`<h2>${title}</h2><dl>${rows.map(v => `<dt>${e(v.title)}</dt><dd>${placeLink(v) ?? e(valueText(v))}</dd>`).join("")}</dl>`);
          }
        }
      }
      return out.join("");
    },
    // Обоснование связи — наш собственный текст, которого нет в энциклопедиях.
    // Выводим его открыто, рядом со ссылкой, а не прячем в интерфейсе.
    links: () => card.links.length === 0 ? "" :
      `<h2>Связи</h2><ul class="relations">${
        card.links.map((l) =>
          `<li><a href="${e(entityPath(l.other_slug))}">${e(l.other_title)}</a>` +
          (l.role_title ? ` (${e(l.role_title)})` : "") +
          (l.justification ? `<p>${e(l.justification)}</p>` : "") + `</li>`
        ).join("")
      }</ul>`,
    // Видео: обложка — ссылка на сам ролик. Обложка — прикреплённое
    // изображение или кадр-превью ролика с подписью «канал · площадка» (Р-68).
    video: () => {
      const url = card.values.find((v) => v.parameter === "url")?.text_value;
      if (!url || !/^https?:/i.test(url)) return "";
      const channel = card.values.find((v) => v.parameter === "video_channel")?.text_value;
      const duration = card.values.find((v) => v.parameter === "duration")?.text_value;
      const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } })();
      const platform = /youtu\.?be/.test(host) ? "YouTube" : /vk\.com|vkvideo/.test(host) ? "VK Видео" : /rutube/.test(host) ? "Rutube" : host;
      const own = card.media[0];
      const cover = own ? mediaUrl(own.asset_id, "screen") : card.video_cover;
      const credit = own ? null : [channel, platform].filter(Boolean).join(" · ");
      return `<h2>Видео</h2><figure class="video-cover">` +
        (cover ? `<a href="${e(url)}" rel="noopener"><img src="${e(cover)}" alt="${e(card.title_ru)}" loading="lazy" /></a>` : "") +
        (credit ? `<figcaption>Кадр: ${e(credit)}</figcaption>` : "") + `</figure>` +
        `<p><a class="button" href="${e(url)}" rel="noopener">Смотреть${platform ? ` на ${e(platform)}` : ""}</a>` +
        (duration ? ` <span class="hint">${e(duration)}</span>` : "") + `</p>`;
    },
    text: () => descriptionHtml ? `<h2>Описание</h2><div class="public-document">${descriptionHtml}</div>` : "",
    // Изображение — цитата (Р-68): под каждым автор и источник.
    gallery: () => card.media.length === 0 ? "" :
      `<h2>Изображения</h2><div class="public-gallery">${
        card.media.map((m) => figureHtml(mediaUrl(m.asset_id, "screen"), m.caption ?? card.title_ru, m)).join("")
      }</div>`,
    // Источник — запись (Р-80): название ведёт на её страницу, адрес — наружу,
    // обстоятельства цитаты — из обоснования связи.
    sources: () => card.sources.length === 0 ? "" :
      `<h2>Источники</h2><ul>${
        card.sources.map((s) => {
          const label = e(s.title || s.url || s.kind_title) + (s.year ? `, ${s.year}` : "");
          const title = s.slug ? `<a href="${e(entityPath(s.slug))}">${label}</a>` : label;
          const out = s.url && /^https?:/i.test(s.url) ? ` — <a href="${e(s.url)}" rel="noopener">${e(s.url)}</a>` : "";
          return `<li>${title}${out}${s.text ? `<p>${e(s.text)}</p>` : ""}</li>`;
        }).join("")
      }</ul>`,
    mentions: () => {
      const mentions = card.mentions.filter((m) => m.owner_slug);
      return mentions.length === 0 ? "" :
        `<h2>Упоминается в материалах</h2><ul>${
          mentions.map((m) =>
            `<li><a href="${e(entityPath(m.owner_slug!))}">${e(m.owner_title ?? m.document_title ?? "")}</a></li>`
          ).join("")
        }</ul>`;
    },
    citation: () => [
      `<details class="cite-disclosure"><summary>Цитировать</summary><h2>Как цитировать</h2>`,
      `<p><b>ГОСТ Р 7.0.100–2018:</b> <span id="cite-gost">${e(cite.gost)}</span></p><button type="button" class="ghost" data-copy="cite-gost">Скопировать ГОСТ</button>`,
      `<p><b>APA:</b> <span id="cite-apa">${e(cite.apa)}</span></p><button type="button" class="ghost" data-copy="cite-apa">Скопировать APA</button>`,
      `<p>Постоянная ссылка: <a href="${e(cite.url)}">${e(cite.url)}</a></p>`,
      `</details>`,
    ].join(""),
  };
  // Без настройки — прежний порядок: страница не пустеет из-за недостающей строки.
  const layout = card.layout.length > 0
    ? card.layout
    : ["indicators", "links", "text", "gallery", "sources", "mentions", "citation"];
  for (const component of layout) {
    const render = sections[component];
    // Раздел — свой блок: облик решает, где ему стоять (Р-91), порядок — тип.
    const html = render ? render() : "";
    if (html) parts.push(`<section class="pc-${component}">${html}</section>`);
  }
  parts.push(`</article>`);
  return parts.join("");
}

/** Место в карточке ведёт на свою страницу: место — такая же запись (Р-85). */
function placeLink(value: CardValue): string | null {
  const place = value.place as Record<string, unknown> | null;
  if (!place || typeof place.slug !== "string") return null;
  return `<a href="${escapeHtml(entityPath(place.slug))}">${escapeHtml(placeText(place))}</a>`;
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
  const found = await resolveEntity(c.req.param("key"), canSeeDrafts(principal));
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
           (select r.created_at from app.revisions r where r.id=e.published_revision_id) as modified_at
      from app.read_entities(false) e
      left join app.materials m on m.entity_id = e.id
     where e.is_published
       -- Изображения и документы — материалы о записях (Р-84): у них есть
       -- страницы, но поисковику их предлагать не нужно — каждое видно на
       -- странице той записи, которую иллюстрирует.
       and e.type_id not in (select app.entity_type_subtree('materials'))
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
