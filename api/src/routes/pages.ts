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
import { sectionCells, sectionLayout } from "../lib/sectionLayouts.ts";
import type { CardLayout } from "../lib/layouts.ts";
import { isPageFrame } from "../lib/cardSections.ts";
import { renderCardGrid } from "../lib/cardGrid.ts";
import { getWidget, widgetImplementations } from "../lib/widgetRegistry.ts";
import { styleQuizKey, styleQuizHtml } from "../lib/styleQuizWidget.ts";
import { modelPath } from "../lib/modelWidgets.ts";
import { sectionCapabilities } from "../lib/cardSections.ts";
import { resolveEntityArgument } from "../lib/widgetInstance.ts";
import { cardWidgetSections, widgetRenderers } from "../lib/cardWidgets.ts";
import { Hono } from "hono";
import type { Context } from "hono";
import {relationSetsHtml} from "../lib/publicRelationSets.ts";
import { sql } from "../lib/db.ts";
import { entities } from "./entities.ts";
import { siteFooter, siteHeader } from "../lib/siteHeader.ts";
import { CATALOG_GROUPS, CATALOG_HIDDEN_ROOTS } from "../lib/entityTypes.ts";
import { itemHtml, dayTitle, loadNews, newsDay, newsFeedHtml, newsNavHtml, newsNeighbours, newsOrder, newsTopics, sameDayHtml, topicHtml } from "../lib/news.ts";
import { CARD_PAGE_ID, readLayout } from "../lib/layouts.ts";
import { config } from "../lib/config.ts";
import { type Principal, canSeeDrafts, require as requirePermission } from "../lib/auth.ts";
import { materialsOf } from "./researchMaterials.ts";
import { ApiError } from "../lib/errors.ts";
import { type AppEnv, encodeCursor, decodeCursor, log } from "../lib/http.ts";
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
  documentBlocks, modelHtml,
  type CompactItem,
  compactLine,
  compactParts,
  compactPicture,
  creditHtml,
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
  /** Черновик: вошедшему — «загружаем», гостю — «не опубликована». */
  draft?: boolean;
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
  if (page.draft) {
    // До отрисовки: есть ли в браузере вход. Вошедший видит «Загружаем
    // запись…», пока скрипт страницы не подставит карточку; гость сразу —
    // «Запись ещё не опубликована». Без этого вошедший секунду видел
    // «Страница не найдена» на каждом черновике.
    lines.push(
      `<script>try{if(Object.keys(localStorage).some(function(k){return /^sb-.+-auth-token$/.test(k)}))` +
        `document.documentElement.classList.add("signed-in")}catch(e){}</script>`,
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

function layout(inner: string, assigned?: (CardLayout & { frame?: CardLayout["slots"] }) | null): string {
  const slots = assigned?.frame ?? assigned?.slots ?? [];
  const frameAttribute = (key: string) => {
    const slot = slots.find(s => s.renderer_key === key);
    return slot ? ` data-layout-slot="${escapeHtml(slot.id)}" data-frame-widget="${key}"` : "";
  };
  return `<div class="shell"${assigned?.grid_columns === 4 ? ' data-page-columns="4"' : ""}><div class="through" aria-hidden="true"></div><div class="through-marks" aria-hidden="true"></div>` +
    `<header class="top" data-site-header${frameAttribute("site_menu")}>${siteHeader(null, "")}</header><main>${inner}</main><footer class="site-foot"${frameAttribute("site_footer")}>${siteFooter()}</footer></div>`;
}

// Оба клиента получают один и тот же элемент меню и ту же модель прав.
pages.get("/api/v1/site-header", (c) => {
  c.header("cache-control", "private, no-store");
  const principal = c.get("principal");
  return c.json({
    html: siteHeader(principal, c.req.query("path") ?? "/"),
    footer: siteFooter(),
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
             (select s from unnest(${CATALOG_HIDDEN_ROOTS}::text[]) r, app.entity_type_subtree(r) s)))
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

interface SectionCell {
  slot_id: string; entity_id: string; html: string; column: number; width: number; row: number; height: number;
}
interface SectionOutput { cells: SectionCell[]; period: number; height: number; columns: number }
export interface CatalogItem {
  section_output?: SectionOutput;
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
  const response = await entities.request(branch ? `/?type=${encodeURIComponent(branch)}${branch === "what" ? "&scope=objects" : ""}` : "/");
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
    (hasMore ? `<button type="button" class="ghost" data-catalog-more onclick="document.documentElement.dataset.catalogMore=location.pathname;document.querySelectorAll('button[data-catalog-more]').forEach(b=>{b.disabled=true;b.textContent='Подключаем каталог…'})">Показать ещё</button>` : "") + `</div>`;
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
  // В разделе с группами первый ряд — группы (как в Catalog.tsx).
  const groups = branch ? CATALOG_GROUPS[branch] : undefined;
  if (groups) return groups.map((g) => ({ code: g.code, title_ru: g.title_ru }));
  return await sql<TypeChip>`
    select ty.code, ty.title_ru
      from app.entity_types ty
     where (${branch}::text is null and ty.parent_id is null
            and ty.code <> all(${CATALOG_HIDDEN_ROOTS}::text[]))
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

function compactTile(row: CatalogItem, index: number) {
    const view = compactParts(row.compact);
    // Первая плашка мозаики крупная — ей нужен экранный размер снимка (Р-91).
    const url = compactPicture(view, index === 0 ? "screen" : "thumbnail");
    const picture = !view.picture ? "" : url
      ? `<img src="${escapeHtml(url)}" alt="" loading="lazy" />`
      : `<div class="card-no-cover">без изображения</div>`;
    return `<a class="card${view.portrait ? " portrait" : ""}" href="${escapeHtml(entityPath(row.slug))}">${picture}` +
      `<div class="kind">${escapeHtml(row.type_title ?? "")}</div>` +
      `<div class="title">${view.mark ? SOURCE_MARK : ""}${escapeHtml(row.title_ru)}</div>` +
      (view.params.length ? `<div class="kind">${escapeHtml(view.params.join(", "))}</div>` : "") +
      (row.title_en ? `<div class="kind">${escapeHtml(row.title_en)}</div>` : "") +
      `<div style="margin-top:8px"><span class="badge status${row.material_status === "published" ? "" : " draft"}">${row.material_status === "published" ? "опубликовано" : "черновик"}</span></div></a>`;
  }

/**
 * Каталог раздела той же разметкой и с теми же данными, что каталог
 * приложения (Catalog.tsx): карточки по компактному виду типа. Данные
 * вложены в страницу, и приложение начинает с них, — поэтому при загрузке
 * клиента ничего не мигает и не перестраивается.
 */
function catalogSlots(layout?: CardLayout | null) {
  return layout?.slots.filter(s => !isPageFrame(s.renderer_key)).map(({ id, renderer_key, row_start, row_span, column_start, column_span }) =>
    ({ id, renderer_key, row_start, row_span, column_start, column_span }));
}

function selectedCells(items: CatalogItem[], offset: number) {
  return items.map((item, index) => {
    const output = item.section_output!;
    const shift = Math.floor((offset + index) / output.period) * output.height;
    return output.cells.map(cell => `<div data-section-slot="${cell.slot_id}" data-entity-id="${cell.entity_id}" style="grid-column:${cell.column}/span ${cell.width};grid-row:${cell.row + shift}/span ${cell.height}">${cell.html}</div>`).join("");
  }).join("");
}

function catalogHtml(title: string, lead: string, page: CatalogPage, branch: string | null, typeLabel: string, chips: TypeChip[] = [], nextHref?: string, assigned?: CardLayout | null, offset = 0): string {
  const cards = page.items[0]?.section_output ? selectedCells(page.items, offset) : assigned ? sectionCells(assigned, page.items, offset, "record_compact", compactTile) : page.items.map(compactTile).join("");
  // Поиск и отбор работают в приложении; здесь они держат место.
  const filters = `<div class="filters"><input placeholder="Поиск по названию" disabled /></div>`;
  // «</» внутри строки закрыл бы тег скрипта раньше времени.
  const data = JSON.stringify({ branch: branch ?? "", page, chips, grid_columns: assigned?.grid_columns, slots: catalogSlots(assigned) }).replaceAll("</", "<\\/");
  const count = nextHref ? listCountHtml(page.items.length, false) + `<a rel="next" href="${escapeHtml(nextHref)}">Показать ещё</a>` : listCountHtml(page.items.length, !!page.next_cursor);
  return `<script type="application/json" id="catalog-initial">${data}</script>` +
    `<section><div class="catalog-head"><h1>${escapeHtml(title)}</h1><p class="sub">${escapeHtml(lead)}</p></div>` +
    `${chipsHtml(chips, branch ? "Все в разделе" : "Все")}${filters}${count}` +
    (page.items.length ? `<div class="${assigned ? "section-grid" : "grid catalog-grid"}" data-columns="${assigned?.grid_columns ?? 3}">${cards}</div>${count}` : branch === "what" || assigned?.repeat_mode ? "<p>Записей пока нет.</p>" : "") + `</section>`;
}

function listLd(path: string, title: string, rows: Pick<ListRow, "slug" | "title_ru">[]) {
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

/**
 * Главная — лента опубликованных новостей (Р-88, ТЗ «Новости», раздел 6);
 * `/news` — та же лента архивом, по страницам с постоянными адресами.
 * Каталог «Всё» больше не главная: разделы — в меню сверху.
 */
const NEWS_PAGE = 12;
const NEWS_LEAD = "Три в день — что интересно архитектору и студенту: здания, нейрогенерация, программы. Каждая — со ссылкой на первоисточник.";

function continuation(path: string, query: URLSearchParams, cursor: string, offset: number) {
  const params = new URLSearchParams(query);
  params.delete("page");
  params.set("after", cursor);
  params.set("offset", String(offset));
  return path + "?" + params;
}

function validSectionQuery(query: URLSearchParams, size: number) {
  const pos = query.get("offset") ?? "0";
  if (!/^\d+$/.test(pos) || Number(pos) >= size) return false;
  const limit = query.get("limit");
  if (limit !== null && (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 24)) return false;
  if (!query.has("after")) return !query.has("offset");
  try {
    const id = decodeCursor(query.get("after")!);
    return id !== null && Number.isSafeInteger(id) && id > 0;
  } catch { return false; }
}

async function newsPage(c: Context<AppEnv>, path: "/" | "/news") {
  const topic = c.req.query("topic") || null;
  const params = new URL(c.req.url).searchParams;
  const assigned = path === "/news" ? await sectionLayout(path) : null;
  const size = assigned?.slots.length || 1;
  const limit = path === "/news" && params.has("limit") ? Number(params.get("limit")) : NEWS_PAGE;
  if (path === "/news" && !validSectionQuery(params, size)) return c.text("Некорректное продолжение выборки", 400);
  const after = path === "/news" ? decodeCursor(c.req.query("after")) : null;
  const order = await newsOrder(topic);
  const index = after === null ? -1 : order.findIndex(row => Number(row.id) === after);
  if (after !== null && index < 0) return await notFound(c);
  const legacyPage = Math.max(1, Math.min(500, Math.trunc(Number(c.req.query("page"))) || 1));
  const start = after === null ? (legacyPage - 1) * limit : index + 1;
  const page = Math.floor(start / limit) + 1;
  const offset = after === null ? start % size : Number(params.get("offset") ?? 0);
  const [rows, topics, latest] = await Promise.all([
    loadNews(order.slice(start, start + limit + 1)),
    newsTopics(),
    topic ? newsOrder(null) : order,
  ]);
  const known = !topic || topics.some((t) => t.code === topic);
  if (!known) return await notFound(c);
  const hasMore = rows.length > limit;
  const shown = rows.slice(0, limit);
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Moscow" });
  const title = path === "/" ? "Новости" : "Архив новостей";
  const query = new URLSearchParams();
  if (topic) query.set("topic", topic);
  if (path === "/news" && params.has("limit")) query.set("limit", String(limit));
  if (after !== null) { query.set("after", encodeCursor(after)); query.set("offset", String(offset)); }
  else if (page > 1) query.set("page", String(page));
  const firstQuery = new URLSearchParams(query);
  for (const key of ["after", "offset", "page"]) firstQuery.delete(key);
  const firstHref = path + (firstQuery.size ? "?" + firstQuery : "");
  const canonical = `${path}${query.toString() ? `?${query}` : ""}`;
  return await render(c, {
    status: 200,
    title: path === "/" ? `${site.name} — курс «Квантовая архитектура»` : `${title} — ${site.name}`,
    description: path === "/" ? site.description : NEWS_LEAD,
    canonical,
    jsonLd: [
      ...(path === "/" && page === 1 && !topic ? [{ "@context": "https://schema.org", ...WEBSITE }] : []),
      listLd(canonical, title, shown.map((row) => ({ slug: row.slug, title_ru: row.title_ru } as ListRow))),
    ],
    publicReader: true,
    body: layout(newsFeedHtml(shown, {
      title, lead: NEWS_LEAD, path, topic, topics, page, hasMore, assigned, offset,
      nextHref: path === "/news" && hasMore ? continuation(path, query, encodeCursor(Number(shown[shown.length - 1].id)), (offset + shown.length) % size) : undefined,
      prevHref: path === "/news" && start > limit && start <= order.length ? continuation(path, query, encodeCursor(Number(order[start - limit - 1].id)), ((offset - limit) % size + size) % size) : path === "/news" ? firstHref : undefined,
      today: latest.filter((row) => newsDay(row) === today),
    }), assigned),
  });
}

pages.get("/", (c) => newsPage(c, "/"));
pages.get("/objects/pattern", async c => {
  const assigned = await sectionLayout("/objects");
  return c.json({ slots: catalogSlots(assigned) ?? null, grid_columns: assigned?.grid_columns ?? 3 });
});
pages.get("/news", (c) => newsPage(c, "/news"));

for (const [path, section] of Object.entries(SECTIONS)) {
  pages.get(path, async (c) => {
    const sectionPath = path === "/objects" || path === "/authors" ? path : null;
    const assigned = sectionPath ? await sectionLayout(sectionPath) : null;
    if (sectionPath && (sectionPath === "/objects" || assigned?.repeat_mode)) {
      const params = new URL(c.req.url).searchParams;
      const size = assigned?.repeat_mode ? selectionSlots(assigned).period : assigned?.slots.length || 1;
      const branch = sectionPath === "/objects" ? "what" : "who";
      const offset = Number(params.get("offset") ?? 0);
      if (!validSectionQuery(params, size)) return c.text("Некорректное продолжение выборки", 400);
      const group = CATALOG_GROUPS[branch]?.find(item => item.code === params.get("g"));
      const filters = new URLSearchParams({ section: sectionPath.slice(1), offset: String(offset), type: params.get("type") || group?.types.join(",") || branch });
      for (const name of ["q", "min", "max", "order", "opt", "archived", "limit"]) {
        for (const value of params.getAll(name)) filters.append(name, value);
      }
      if (params.get("by")) { filters.set("parameter", params.get("by")!); filters.set("sort", "parameter"); }
      if (params.has("after")) filters.set("cursor", params.get("after")!);
      const response = await entities.request("/?" + filters);
      if (!response.ok) return c.text("Ошибка выборки каталога", response.status === 400 ? 400 : 500);
      const result: CatalogPage = await response.json();
      const chips = await typeChips(branch);
      const canonical = path + (params.size ? "?" + params : "");
      return await render(c, {
        status: 200, title: section.title + " — " + site.name, description: section.lead, canonical, catalog: true,
        jsonLd: [listLd(canonical, section.title, result.items)],
        body: layout(catalogHtml(section.title, section.lead, result, branch, "Все в разделе", chips,
          result.next_cursor ? continuation(path, params, result.next_cursor, (offset + result.items.length) % size) : undefined, assigned, offset), assigned),
      });
    }
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
/** Число по-русски: пробел между разрядами, запятая в дробной части. */
function num(value: number): string {
  return value.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

/** Ячейка таблицы: вариант — названием, число — с разрядами. */
function cellText(cell: unknown): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "object") return String((cell as { title?: string }).title ?? "");
  if (typeof cell === "number") return num(cell);
  return String(cell);
}

/** Значение-таблица на странице — как есть. Площадная программа — свой раздел. */
function tableValueHtml(value: CardValue): string {
  const e = escapeHtml;
  const rows = value.rows ?? [];
  const columns = (value.columns ?? []).filter((c) => rows.some((r) => r[c.code] !== undefined && r[c.code] !== null));
  if (rows.length === 0) return "";
  const isNum = (c: { value_type: string }) => c.value_type === "number" || c.value_type === "integer";
  return `<h3>${e(value.title)}</h3><div class="table-scroll"><table class="value-table"><thead><tr>${
    columns.map((c) => `<th${isNum(c) ? ' class="num"' : ""}>${e(c.title)}${c.unit ? `, ${e(c.unit)}` : ""}</th>`).join("")}</tr></thead><tbody>${
    rows.map((r) => `<tr>${columns.map((c) => `<td${isNum(c) ? ' class="num"' : ""}>${e(cellText(r[c.code]))}</td>`).join("")}</tr>`).join("")
  }</tbody></table></div>`;
}

/** Параметры площадной программы: таблица и свойства всего документа. */
const PROGRAM_PARAMS = new Set([
  "area_program", "program_stage", "program_area_base", "program_circulation_method", "program_circulation_factor",
]);

type ProgramRow = Record<string, unknown>;
type ProgramOption = { code?: string; title?: string; path?: { code: string; title: string; sort?: number }[] };

/** Площадь строки: «Площадь всего», иначе площадь × количество. */
function programRowArea(r: ProgramRow): number | null {
  if (typeof r.program_area_total === "number") return r.program_area_total;
  if (typeof r.program_area === "number") return r.program_area * (typeof r.program_count === "number" ? r.program_count : 1);
  return null;
}

/** «1 строка, 2 строки, 5 строк». */
function rowsWord(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 14) return "строк";
  if (n % 10 === 1) return "строка";
  if (n % 10 >= 2 && n % 10 <= 4) return "строки";
  return "строк";
}

/**
 * Площадная программа на странице записи — по уровням классификатора
 * (WIKI «Классификатор помещений»): зона → назначение → строки. Каждый
 * уровень — раскрывающийся блок с площадью и долей; раскрывается без
 * скриптов. «В итог: нет» показывается, но не складывается. Программ может
 * быть несколько — по одной на группу сведений (состояние проекта).
 */
function programHtml(card: PublicCard): string {
  const e = escapeHtml;
  const programs = card.values.filter((v) => v.parameter === "area_program" && (v.rows ?? []).length > 0);
  if (programs.length === 0) return "";
  const counted = (r: ProgramRow) => (r.program_in_total as ProgramOption | undefined)?.code !== "no";
  const sum = (list: ProgramRow[]) => list.filter(counted).reduce((acc, r) => acc + (programRowArea(r) ?? 0), 0);
  const pathOf = (r: ProgramRow) => (r.program_purpose as ProgramOption | undefined)?.path ?? [];
  const isNum = (c: { value_type: string }) => c.value_type === "number" || c.value_type === "integer";

  // Колонки строк — только заполненные; назначение и зона уже в заголовках
  // уровней, «Площадь всего» считается всегда.
  // Колонки — по строкам своего раздела: пустые у гримёрных «Габариты» и у
  // залов «№» не занимают места.
  const columnsOf = (value: CardValue, rows: ProgramRow[]) => {
    const skip = new Set(["program_purpose", "program_area_total", "program_in_total"]);
    return (value.columns ?? []).filter((c) => !skip.has(c.code) &&
      rows.some((r) => r[c.code] !== undefined && r[c.code] !== null && r[c.code] !== ""));
  };

  const rowsTable = (value: CardValue, rows: ProgramRow[], deep: boolean) => {
    const columns = columnsOf(value, rows);
    const head = (deep ? ["<th>Назначение</th>"] : []).concat(
      columns.map((c) => `<th${isNum(c) ? ' class="num"' : ""}>${e(c.title)}${c.unit ? `, ${e(c.unit)}` : ""}</th>`),
      ['<th class="num">Площадь всего, м²</th>'],
    );
    const body = rows.map((r) => {
      const deeper = pathOf(r).slice(2).map((p) => p.title).join(" — ");
      const area = programRowArea(r);
      return `<tr${counted(r) ? "" : ' class="not-counted" title="Не входит в итог"'}>` +
        (deep ? `<td>${e(deeper)}</td>` : "") +
        columns.map((c) => `<td${isNum(c) ? ' class="num"' : ""}>${e(cellText(r[c.code]))}</td>`).join("") +
        `<td class="num">${area === null ? "—" : num(area)}${counted(r) ? "" : " *"}</td></tr>`;
    }).join("");
    return `<div class="table-scroll"><table class="value-table"><thead><tr>${head.join("")}</tr></thead><tbody>${body}</tbody></table></div>`;
  };

  // Узлы одного уровня дерева: ключ — код узла на этом уровне пути.
  // Порядок — классификатора (sort узла), а не строк источника.
  const groupBy = (rows: ProgramRow[], level: number) => {
    const map = new Map<string, { title: string; sort: number; rows: ProgramRow[] }>();
    for (const r of rows) {
      const node = pathOf(r)[level];
      const key = node?.code ?? "";
      if (!map.has(key)) {
        map.set(key, {
          title: node?.title ?? (level === 0 ? "Без назначения" : "Без уточнения"),
          sort: node?.sort ?? (level === 0 ? 10_000 : -1),
          rows: [],
        });
      }
      map.get(key)!.rows.push(r);
    }
    return [...map.values()].sort((a, b) => a.sort - b.sort);
  };

  const summary = (title: string, rows: ProgramRow[], total: number) => {
    const area = sum(rows);
    const share = total > 0 ? area / total * 100 : 0;
    return `<summary><span class="program-title">${e(title)}</span>` +
      `<span class="program-count">${rows.length} ${rowsWord(rows.length)}</span>` +
      `<span class="program-area">${area > 0 ? `${num(area)} м²` : "—"}</span>` +
      `<span class="program-share">${total > 0 && area > 0 ? `${num(Math.round(share * 10) / 10)} %` : ""}</span>` +
      `<span class="program-bar"><i style="width:${Math.min(100, Math.round(share * 10) / 10)}%"></i></span></summary>`;
  };

  const blocks = programs.map((value) => {
    const rows = value.rows ?? [];
    const total = sum(rows);
    const group = card.values.filter((v) => v.indicator_id === value.indicator_id);
    const prop = (code: string) => group.find((v) => v.parameter === code);
    const meta = ([
      ["Стадия", prop("program_stage")], ["База площади", prop("program_area_base")],
      ["Пути движения и техника", prop("program_circulation_method")],
      ["Коэффициент", prop("program_circulation_factor")],
    ] as [string, CardValue | undefined][])
      .filter(([, v]) => v).map(([t, v]) => `${t}: ${e(valueText(v!))}`).join(" · ");
    const withArea = rows.filter((r) => programRowArea(r) !== null).length;
    // Откуда цифра (0047): сколько площади из данных, сколько посчитано
    // редакцией, сколько оценено. Порядок — порядок вариантов.
    const bases = new Map<string, { title: string; area: number }>();
    for (const r of rows.filter(counted)) {
      const area = programRowArea(r);
      const basis = r.program_area_basis as ProgramOption | undefined;
      if (area === null || !basis?.code) continue;
      const item = bases.get(basis.code) ?? { title: basis.title ?? basis.code, area: 0 };
      item.area += area;
      bases.set(basis.code, item);
    }
    const order = ["document", "dimensions", "estimate"];
    const origin = [...bases.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
      .map(([, v]) => `${e(v.title)} — ${num(v.area)} м²`).join(", ");
    const heading = programs.length > 1 || value.indicator_title !== "Сведения"
      ? `<h3>${e(value.indicator_title)}${value.measured_year ? ` · ${value.measured_year}` : ""}</h3>` : "";
    const zones = groupBy(rows, 0).map((zone) => {
      const purposes = groupBy(zone.rows, 1).map((purpose) => {
        const deep = purpose.rows.some((r) => pathOf(r).length > 2);
        return `<details class="program-purpose">${summary(purpose.title, purpose.rows, total)}` +
          rowsTable(value, purpose.rows, deep) + `</details>`;
      }).join("");
      return `<details class="program-zone">${summary(zone.title, zone.rows, total)}${purposes}</details>`;
    }).join("");
    const excluded = rows.some((r) => !counted(r))
      ? `<p class="hint">* Не входит в итог: площадь уже учтена в другой строке.</p>` : "";
    return `<div class="program">${heading}` +
      (meta ? `<p class="program-meta">${meta}</p>` : "") +
      `<p class="program-total"><b>Итого: ${num(total)} м²</b> · ${rows.length} ${rowsWord(rows.length)}, площадь известна у ${withArea}</p>` +
      (origin ? `<p class="program-meta">Откуда цифра: ${origin}</p>` : "") +
      zones + excluded + `</div>`;
  }).join("");
  return `<section class="program-section"><h2>Площадная программа</h2>${blocks}</section>`;
}

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
  if (value.date_start_year && value.date_start_month && value.date_start_day && !value.date_end_year && !value.is_approximate) {
    // Точный день — «3 октября 2026»: так у выхода новости и у событий.
    const iso = `${value.date_start_year}-${String(value.date_start_month).padStart(2, "0")}-${String(value.date_start_day).padStart(2, "0")}`;
    return `${dayTitle(iso).title} ${value.date_start_year}`;
  }
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
  // Новость сайта — статья-новость для поисковика (ТЗ «Новости», раздел 2).
  if (codes.includes("news")) return ["NewsArticle"];
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
  const section = card.type_path.some((t) => t.code === "news")
    ? ["/news", "Новости"]
    : root === "who"
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

/** Новость: соседи в ленте и день выхода — для листания на её странице. */
interface NewsExtra {
  nav: { before: Awaited<ReturnType<typeof newsNeighbours>>["before"]; after: Awaited<ReturnType<typeof newsNeighbours>>["after"] };
  sameDay: Awaited<ReturnType<typeof newsNeighbours>>["sameDay"];
}

async function newsExtra(card: PublicCard): Promise<NewsExtra | null> {
  if (!card.type_path.some((t) => t.code === "news")) return null;
  const { before, after, sameDay } = await newsNeighbours(card.id);
  return { nav: { before, after }, sameDay };
}

/** Надзаголовок новости: путь «Новости — день, слот», «Новость // тема», стрелки. */
function newsHead(card: PublicCard, extra: NewsExtra): string {
  const e = escapeHtml;
  const release = card.values.find((v) => v.parameter === "news_release");
  const time = card.values.find((v) => v.parameter === "news_release_time")?.text_value ?? "";
  const day = release?.date_start_year
    ? dayTitle(`${release.date_start_year}-${String(release.date_start_month ?? 1).padStart(2, "0")}-${String(release.date_start_day ?? 1).padStart(2, "0")}`).title
    : "";
  const topics = card.values.filter((v) => v.parameter === "news_topic" && v.option_title)
    .map((v) => topicHtml(v.option_code, v.option_title!));
  const arrow = (row: NewsExtra["nav"]["before"], label: string, hint: string) => row
    ? `<a class="news-arrow" href="${e(entityPath(row.slug))}" aria-label="${e(hint)}: ${e(row.title_ru)}" title="${e(hint)} — клавиша ${label}">${label}</a>`
    : `<span class="news-arrow is-empty" aria-hidden="true">${label}</span>`;
  return `<div class="news-path"><span class="mono"><a href="/news">Новости</a>${day ? ` — ${e(day)}` : ""}${time ? `, ${e(time)}` : ""}</span>` +
    `<span class="news-arrows">${arrow(extra.nav.before, "←", "Раньше")}${arrow(extra.nav.after, "→", "Позже")}</span></div>` +
    `<div class="kick">Новость<span class="sl">//</span>${topics.join("") || e(card.type_title)}</div>`;
}

/** Размер файла по-человечески. */
function bytesText(n: number): string {
  if (n >= 1e9) return `${num(Math.round(n / 1e8) / 10)} ГБ`;
  if (n >= 1e6) return `${num(Math.round(n / 1e5) / 10)} МБ`;
  return `${num(Math.max(1, Math.round(n / 1e3)))} КБ`;
}

type Materials = NonNullable<Awaited<ReturnType<typeof materialsOf>>>;

/**
 * «Материалы в работе» — только в карточке для редактора: папка в
 * Dropbox 2VHUTEMAS, что в ней собрано по подпапкам и что уже в медиатеке
 * (по контрольной сумме). Гостевая страница этот раздел не получает.
 */
function materialsHtml(m: Materials | null): string {
  const e = escapeHtml;
  if (!m) {
    return `<section class="research-materials"><h2>Материалы в работе <span class="badge">видят редакторы</span></h2>` +
      `<p class="hint">Папка материалов не привязана. Положите папку с названием записи в <code>2VHUTEMAS/ЧТО/ПРОЕКТЫ</code> или <code>КТО/ЛЮДИ</code> ` +
      `и запустите <code>python tools/sync_materials.py</code>.</p></section>`;
  }
  const total = m.files.reduce((a, f) => a + Number(f.size_bytes), 0);
  const inMedia = m.files.filter((f) => f.media_entity_id).length;
  const groups = new Map<string, typeof m.files>();
  for (const f of m.files) {
    const top = f.path.includes("/") ? f.path.slice(0, f.path.indexOf("/")) : "";
    if (!groups.has(top)) groups.set(top, []);
    groups.get(top)!.push(f);
  }
  const synced = m.synced_at ? new Date(m.synced_at).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" }) : "ещё не было";
  const blocks = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, "ru")).map(([top, files]) => {
    const size = files.reduce((a, f) => a + Number(f.size_bytes), 0);
    const rows = files.map((f) => {
      const name = top ? f.path.slice(top.length + 1) : f.path;
      const status = f.media_entity_id
        ? `<a href="${e(entityPath(f.media_slug ?? String(f.media_entity_id)))}">в медиатеке${f.media_published ? "" : " · черновик"}</a>`
        : `<span class="hint">собрано</span>`;
      const date = f.modified_at ? new Date(f.modified_at).toLocaleDateString("ru-RU") : "";
      return `<tr><td>${e(name)}</td><td class="num">${bytesText(Number(f.size_bytes))}</td><td>${e(date)}</td><td>${status}</td></tr>`;
    }).join("");
    return `<details class="materials-folder"><summary><span>${e(top || "в корне папки")}</span>` +
      `<span class="hint">${files.length} · ${bytesText(size)}</span></summary>` +
      `<div class="table-scroll"><table class="value-table"><tbody>${rows}</tbody></table></div></details>`;
  }).join("");
  return `<section class="research-materials"><h2>Материалы в работе <span class="badge">видят редакторы</span></h2>` +
    `<p class="hint">Папка <a href="vhutemas-folder:${e(m.path.split("/").map(encodeURIComponent).join("/"))}" title="Открыть в Проводнике"><code>2VHUTEMAS/${e(m.path)}</code></a> · ${m.files.length} файлов, ${bytesText(total)} · ` +
    `в медиатеке ${inMedia} · опись обновлена: ${e(synced)}</p>${blocks}</section>`;
}

function cardBody(card: PublicCard, descriptionHtml: string, cite: ReturnType<typeof citation>, news: NewsExtra | null = null,
                  materials: Materials | null | undefined = undefined, singleWidget?: { key: string; design: string | null }, layoutPreview = false) {
  const e = escapeHtml;
  const parts: string[] = [];
  const editPath = `/entities/${card.id}/edit`;
  parts.push(`<article class="public-card${news ? " is-news" : ""}">`);
  const headerStart = parts.length;
  parts.push(`<header class="pc-head">`, news ? newsHead(card, news) : "", `<h1>${e(card.title_ru)}<span class="reader-actions" data-reader-edit data-href="${e(editPath)}" hidden></span></h1>`);
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
  const programSide = card.values.find(v=>v.parameter==='area_program')?.card_side ?? 'left';
  function parameterValuesHtml(values: CardValue[]): string {
      const out: string[] = [];
      const groups = new Map<number, CardValue[]>();
      // Площадная программа и её свойства — в своём разделе (program).
      for (const value of values.filter((v) => !PROGRAM_PARAMS.has(v.parameter)&&v.parameter!=='style_solutions')) {
        if (!groups.has(value.indicator_id)) groups.set(value.indicator_id, []);
        groups.get(value.indicator_id)!.push(value);
      }
      for (const values of groups.values()) {
        const group = values[0];
        if (groups.size > 1 || !group.is_current) out.push(`<h2>${e(group.indicator_title)}${group.measured_year ? ` · ${group.measured_year}` : ""}${group.is_current ? "" : " · не действующие"}</h2>`);
        for (const [title, rows] of [
          ["Показатели", values.filter(v => v.value_type !== "place" && v.value_type !== "date" && v.value_type !== "table")],
          ["Места", values.filter(v => v.value_type === "place")],
          ["Датировки", values.filter(v => v.value_type === "date")],
        ] as [string, CardValue[]][]) {
          if (rows.length) {
            out.push(`<h2>${title}</h2><dl>${rows.map(v => `<dt>${e(v.title)}</dt><dd>${placeLink(v) ?? e(valueText(v))}</dd>`).join("")}</dl>`);
          }
        }
        // Таблицы (площадная программа) — после величин своей группы.
        for (const v of values.filter((x) => x.value_type === "table")) out.push(tableValueHtml(v));
      }
      return out.join("");
  }
  const renderedWidgets = new Set<string>();
  const panelSets = () => (card.relation_sets ?? []).filter(set =>
    set.code !== "style_solutions" || !renderedWidgets.has("style_analysis"));
  const sections: Record<string, (side?: "left" | "right") => string> = {
    indicators: () => {
      // Новость: одни «Сведения» — выход днём и слотом, тема, первоисточник
      // ссылкой, публикация в источнике. Значимость — оценка робота для
      // редактора, читателю её не показываем.
      if (news) {
        const by = (code: string) => card.values.filter(v => v.parameter === code && v.card_side !== "left" &&
          (!card.widgetLayout || !card.parameterSetOrder || !v.set_id || card.parameterSetOrder.includes(v.set_id)));
        const rows: [string, string][] = [];
        const release = by("news_release")[0];
        const time = by("news_release_time")[0]?.text_value;
        if (release) rows.push(["Выход", e(valueText(release)) + (time ? `, ${e(time)}` : "")]);
        const topics = by("news_topic").filter((v) => v.option_title).map((v) => topicHtml(v.option_code, v.option_title!));
        if (topics.length) rows.push([topics.length > 1 ? "Темы" : "Тема", topics.join("")]);
        const url = by("url")[0]?.text_value;
        if (url && /^https?:/i.test(url)) {
          const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } })();
          rows.push(["Первоисточник", `<a href="${e(url)}" rel="noopener">${e(host)}</a>`]);
        }
        const published = by("publication")[0];
        if (published) rows.push(["Опубликовано в источнике", e(valueText(published))]);
        return rows.length ? `<h2>Сведения</h2><dl>${rows.map(([t, v]) => `<dt>${t}</dt><dd>${v}</dd>`).join("")}</dl>` : "";
      }
      return parameterValuesHtml(card.values.filter(v => v.card_side !== 'left')) + relationSetsHtml(panelSets(), 'right') +
        (programSide === 'right' ? programHtml(card) : '');
    },
    // Обоснование связи — наш собственный текст, которого нет в энциклопедиях.
    // Выводим его открыто, рядом со ссылкой, а не прячем в интерфейсе.
    parameters: (selectedSide) => {
      const sets = panelSets();
      const order = card.parameterSetOrder ?? [...new Set([
        ...card.values.flatMap(v => v.set_id ? [v.set_id] : []), ...sets.map(s => s.id),
      ])];
      const sides: Record<"left" | "right", string[]> = {left: [], right: []};
      for (const id of [...order, null]) {
        const values = card.values.filter(v => (v.set_id ?? null) === id);
        for (const side of ["left", "right"] as const) {
          const group = values.filter(v => (v.card_side ?? "right") === side);
          // News uses a dedicated published-field list; keep its right-hand metadata below.
          if (!news || side === "left") {
            sides[side].push(parameterValuesHtml(group));
            if (group.some(v => v.parameter === "area_program")) sides[side].push(programHtml(card));
            sides[side].push(relationSetsHtml(sets.filter(s => s.id === id), side));
          }
        }
      }
      if (news) sides.right.push(sections.indicators());
      const visibleSides = selectedSide ? [selectedSide] : (["left", "right"] as const);
      return visibleSides.map(side => {
        const html = sides[side].join("");
        return html ? `<div class="parameter-groups-${side}">${html}</div>` : "";
      }).join("");
    },
    links: () => {
      if (card.links.length === 0) return "";
      const graph = {
        center: card.title_ru,
        nodes: card.links.map((l) => ({ href: entityPath(l.other_slug), title: l.other_title, role: l.role_title ?? "", note: l.justification ?? "" })),
        // Связи соседей — показываются галочкой «Связи соседей».
        extra: card.neighbor_links.map((n) => ({ a: entityPath(n.a_slug), at: n.a_title, b: entityPath(n.b_slug), bt: n.b_title })),
      };
      const list = card.links.map((l) =>
        `<li><a href="${e(entityPath(l.other_slug))}">${e(l.other_title)}</a>` +
        (l.role_title ? `<span class="rel-role">${e(l.role_title)}</span>` : "") +
        (l.justification ? `<p>${e(l.justification)}</p>` : "") +
        l.citations.map(q=>`<blockquote>${q.quote?`<p>${e(q.quote)}</p>`:""}<footer><a href="${e(entityPath(q.source_slug))}">${e(q.source_title)}</a>${q.locator?` · ${e(q.locator)}`:""}${q.phase?` · Фаза: ${e(q.phase)}`:""}${q.zone?` · Зона: ${e(q.zone)}`:""}${q.accessed_at?` · Дата обращения: ${e(q.accessed_at)}`:""}</footer></blockquote>`).join("") + `</li>`
      ).join("");
      // Связей много: раздел свёрнут, внутри граф (по умолчанию) или компактный список.
      return `<details class="rel-box"><summary>Связи <span class="rel-count">${card.links.length}</span></summary>` +
        `<div class="rel-tabs"><button type="button" class="is-on" data-rel-view="graph">Граф</button><button type="button" data-rel-view="list">Список</button>` +
        (graph.extra.length ? `<label class="rel-extra"><input type="checkbox" data-rel-extra> Связи соседей</label>` : "") + `</div>` +
        `<div class="rel-graph" data-rel-graph="${e(JSON.stringify(graph))}"></div>` +
        `<ul class="relations rel-list" hidden>${list}</ul></details>`;
    },
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
    // У новости текст идёт сразу за заголовком, без «Описания».
    // Площадная программа — под связями, по уровням классификатора.
    program: () => programSide === 'left' ? programHtml(card) : '',
    parameter_sets: () => parameterValuesHtml(card.values.filter(v=>v.card_side==='left')) + relationSetsHtml(panelSets(), 'left'),
    text: () => descriptionHtml ? `${news ? "" : "<h2>Описание</h2>"}<div class="public-document">${descriptionHtml}</div>` : "",
    // Изображение — цитата (Р-68): под каждым автор и источник.
    gallery: () => card.media.length === 0 ? "" :
      `<h2>Изображения</h2><div class="public-gallery">${
        card.media.map((m) => figureHtml(mediaUrl(m.asset_id, "screen"), m.caption ?? card.title_ru, m)).join("")
      }</div>`,
    // Чертежи — просмотр DXF с замерами (скрипт страницы подключает его, когда
    // раздел попадает на экран). Подпись — как у цитаты (Р-68): автор,
    // правообладатель, источник; без скриптов — ссылка на файл.
    drawings: () => card.drawings.length === 0 ? "" :
      `<h2>Чертежи</h2>${card.drawings.map((d) => {
        const url = mediaUrl(d.asset_id, "original");
        const credit = creditHtml({ author: [d.author, d.credit].filter(Boolean).join(" / ") || null, source: d.source, source_url: d.source_url });
        return `<figure class="drawing"><div class="drawing-view" data-drawing="${e(url)}" data-title="${e(d.title ?? "")}"` +
          `${d.unit_mm ? ` data-unit-mm="${e(d.unit_mm)}"` : ""}>` +
          `<a class="drawing-fallback" href="${e(url)}" download="${e(d.original_name ?? "drawing.dxf")}">Скачать чертёж (DXF)</a></div>` +
          `<figcaption><b>${e(d.title ?? "Чертёж")}</b>${credit ? `<br>${credit}` : ""}${d.license ? ` · ${e(d.license)}` : ""}</figcaption></figure>`;
      }).join("")}`,
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
  if (singleWidget) return widgetRenderers(card, sections).get(singleWidget.key)?.(card.id, singleWidget.design) ?? "";
  if (card.widgetLayout) {
    const slots = card.widgetLayout.slots.filter(s => !isPageFrame(s.renderer_key));
    const registry = widgetRenderers(card, sections);
    const target = (slot: typeof slots[number]) => Number(resolveEntityArgument(slot.call_params?.entity_id, String(card.id)));
    const extras = new Map<string, string>();
    for (const slot of slots) {
      if (Object.hasOwn(sections, slot.renderer_key)) continue;
      const render = registry.get(slot.renderer_key);
      if (!render) continue;
      const html = render(target(slot), slot.design);
      extras.set(slot.id, html);
      if (html) renderedWidgets.add(slot.renderer_key);
    }
    const parameterSlots = slots.filter(slot => slot.renderer_key === "parameters");
    const splitParameters = card.widgetLayout.grid_columns !== 4 && parameterSlots.length === 2 &&
      parameterSlots.some(s => s.column_start === 1 && s.column_span === 2) &&
      parameterSlots.some(s => s.column_start === 3 && s.column_span === 1);
    const header = parts.splice(headerStart).join("");
    parts.push(renderCardGrid(slots, slot => {
      if (splitParameters && slot.renderer_key === "parameters" && target(slot) === card.id) {
        return sections.parameters(slot.column_start === 3 ? "right" : "left");
      }
      if (extras.has(slot.id)) return extras.get(slot.id)!;
      return registry.get(slot.renderer_key)?.(target(slot), slot.design) ?? "";
    }, layoutPreview, header, card.widgetLayout.grid_columns));
  } else {
    // Без настройки — прежний порядок: страница не пустеет из-за недостающей строки.
    const layout = card.layout.length > 0
      ? card.layout
      : ["indicators", "links", "program", "text", "gallery", "drawings", "sources", "mentions", "citation"];
    const withParameterSets = [...layout];
    if (!withParameterSets.includes('parameter_sets')) {
      const textAt=withParameterSets.indexOf('text');
      withParameterSets.splice(textAt<0?withParameterSets.length:textAt,0,'parameter_sets');
    }
    const widgets = cardWidgetSections(card, withParameterSets, undefined, renderedWidgets);
    for (const component of withParameterSets) {
      const render = sections[component];
      // Раздел — свой блок: облик решает, где ему стоять (Р-91), порядок — тип.
      const html = render ? render() : "";
      if (html) parts.push(`<section class="pc-${component}">${html}</section>`);
      parts.push(...(widgets.get(component) ?? []));
      widgets.delete(component);
    }
    parts.push(...(widgets.get("") ?? []));
  }
  if (news) {
    // Листать ленту: «Раньше / Позже» в конце, «Ещё за этот день» — на полях.
    parts.push(`<section class="pc-news-nav">${newsNavHtml(news.nav)}</section>`);
    const release = card.values.find((v) => v.parameter === "news_release");
    const day = release?.date_start_year
      ? `${release.date_start_year}-${String(release.date_start_month ?? 1).padStart(2, "0")}-${String(release.date_start_day ?? 1).padStart(2, "0")}`
      : null;
    const same = sameDayHtml(news.sameDay, day);
    if (same) parts.push(`<aside class="pc-news-day">${same}</aside>`);
  }
  // Материалы в работе — только в карточке для редактора (materials передан).
  if (materials !== undefined) parts.push(materialsHtml(materials));
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
  if (!found) return await (await draftExists(key) ? draftPage(c, key) : notFound(c, key));
  if (!found.isPublished) return await draftPage(c, key);
  if (found.moved || found.slug !== key) {
    return c.redirect(entityPath(found.slug), 301);
  }
  const card = await loadPublicCard(found.id);
  if (!card) return await notFound(c, key);

  const descriptionHtml = await documentHtml(card, null);
  const lead = card.document ? firstParagraph(card.document.body_json) : "";
  const description = summary(lead) ||
    summary([card.type_title, ...card.values.slice(0, 4).map((v) => `${v.title}: ${valueText(v)}`)]
      .join(". "));
  const yearOf = new Date(card.modified_at).getFullYear();
  const cite = citation({ title: card.title_ru, slug: card.slug, authors: card.authors, year: yearOf });
  const root = card.type_path[0]?.code;
  const news = await newsExtra(card);

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
    body: layout(cardBody(card, descriptionHtml, cite, news), card.widgetLayout),
  });
});

// Тот же рендер для просмотра черновиков: авторизация общая для /api/v1/*.
// Ответ не кэшируется; гость не получает ни названия, ни адреса черновика.
pages.get("/api/v1/document-widgets", async c => {
  requirePermission(c.get("principal"), "edit");
  const rows = await sql<{id: string; name: string; renderer_key: string}>`select id,name,renderer_key from app.widgets order by name,id`;
  const items = rows.flatMap(row => {
    const spec = widgetImplementations.get(row.renderer_key) ?? sectionCapabilities(row.renderer_key);
    return spec ? [{id: row.id, name: row.name, renderer_key: row.renderer_key, designs: spec.designs, standalone: row.renderer_key === styleQuizKey, model_path: modelPath(row.renderer_key)}] : [];
  });
  return c.json({items});
});

function selectionSlots(layout: CardLayout) {
  const first = layout.slots.findIndex(slot => slot.id === layout.first_slot_id);
  const last = layout.slots.findIndex(slot => slot.id === layout.last_slot_id);
  if (first < 0 || last < first) throw new Error("Некорректные границы повторяемой части");
  const slots = layout.slots.slice(first, last + 1).filter(slot => !isPageFrame(slot.renderer_key));
  if (!slots.length) return { slots, start: 1, height: 1, period: 1 };
  const start = Math.min(...slots.map(s => s.row_start));
  const height = Math.max(...slots.map(s => s.row_start + s.row_span)) - start;
  return { slots, start, height, period: layout.repeat_mode === "journal" ? slots.length : 1 };
}

export async function projectSectionItems(layout: CardLayout, items: (CatalogItem & { id: string | number })[], offset: number, principal: Principal | null) {
  const { slots, start, height, period } = selectionSlots(layout);
  if (!Number.isInteger(offset) || offset < 0 || offset >= period) throw new ApiError("validation_failed", "Некорректная позиция в образце");
  const result = [];
  for (const [i, item] of items.entries()) {
    const cells: SectionCell[] = [];
    const targets = layout.repeat_mode === "journal" && slots.length ? [slots[(offset + i) % period]] : slots;
    for (const slot of targets) {
      const id = resolveEntityArgument(slot.call_params?.entity_id, String(item.id))!;
      const key = slot.renderer_key;
      const src = modelPath(key);
      let html: string;
      if (src) html = modelHtml({ ...slot.display_options, src });
      else if (key === styleQuizKey) html = styleQuizHtml();
      else if (key === "record_compact" && id === String(item.id)) html = compactTile(item, i);
      else html = (await drawDocumentWidget(key, Number(id), slot.design, principal, [])).html;
      if (html) cells.push({ slot_id: slot.id, entity_id: id, html, column: slot.column_start,
        width: slot.column_span, row: slot.row_start - start + 1, height: slot.row_span });
    }
    result.push({ ...item, section_output: { cells, period, height, columns: layout.grid_columns ?? 3 } });
  }
  return result;
}

type WidgetOutput = { html: string; title: string; reason?: string };
const widgetUid = /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i;

async function documentHtml(card: PublicCard, principal: Principal | null, ancestors: readonly number[] = []) {
  if (!card.document) return "";
  const chain = [...ancestors, card.id];
  return await documentBlocks(card.document.body_json, {entities: card.refs, publicAssets: card.publicAssets}, async props => {
    if (typeof props.widget_id !== "string" || !widgetUid.test(props.widget_id)) return "";
    const entityId = Number(props.entity_id);

    const widget = await getWidget(props.widget_id);
    const design = props.design || null;
    if (!widget || (design !== null && (typeof design !== "string" || !widget.designs.includes(design)))) return "";
    if (widget.renderer_key === styleQuizKey) return props.entity_id ? "" : styleQuizHtml();
    const src = modelPath(widget.renderer_key);
    if (src) return modelHtml({...props, src});
    if (!Number.isSafeInteger(entityId) || entityId <= 0) return "";
    const output = await drawDocumentWidget(widget.renderer_key, entityId, design as string | null, principal, chain);
    return (output.reason && canSeeDrafts(principal) ? `<p class="hint">${escapeHtml(output.reason)}</p>` : "") + output.html;
  });
}

async function drawDocumentWidget(key: string, entityId: number, design: string | null,
  principal: Principal | null, ancestors: readonly number[]): Promise<WidgetOutput> {
  // Stop only this text expansion, before fetching the repeated entity.
  if (key === "text" && ancestors.includes(entityId)) return {html:"", title:""};
  const editor = canSeeDrafts(principal);
  const card = await loadPublicCard(entityId, principal, true);
  if (!card) {
    if (editor) {
      const [target] = await sql<{status:string}>`select status from app.entities where id=${entityId}`;
      if (target?.status === "archived") return {html:"", title:"", reason:"Удалена"};
    }
    return {html:"", title:"", reason:"Недоступна"};
  }
  let html: string;
  if (key === "record_compact") {
    const [data] = await sql<{compact: CompactItem[]}>`select app.compact_json(${entityId},${canSeeDrafts(principal)}) as compact`;
    html = compactTile({...card, compact: data.compact, material_status: card.is_published ? "published" : "draft"}, 1);
  } else if (key === "news_compact") {
    const target = (await newsOrder(null)).find(row => Number(row.id) === entityId);
    html = target ? itemHtml((await loadNews([target]))[0], false) : "";
  } else {
    const body = key === "text" ? await documentHtml(card, principal, ancestors) : "";
    const cite = citation({title: card.title_ru, slug: card.slug, authors: card.authors, year: new Date(card.modified_at).getFullYear()});
    html = cardBody(card, body, cite, key === "parameters" ? await newsExtra(card) : null, undefined, {key, design});
  }
  return {html, title: card.title_ru, reason: editor && !card.is_published ? "Черновик" : undefined};
}

pages.get("/api/v1/document-widgets/:id/preview", async c => {
  const principal = requirePermission(c.get("principal"), "edit");
  const id = c.req.param("id");
  if (!/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id)) throw new ApiError("validation_failed", "Некорректный UID виджета");
  const widget = await getWidget(id);
  if (!widget) throw new ApiError("not_found", "Виджет недоступен");
  const design = c.req.query("design") || null;
  if (design && !widget.designs.includes(design)) throw new ApiError("validation_failed", "Неизвестное оформление");
  const src = modelPath(widget.renderer_key);
  if (src) {
    c.header("cache-control", "private, no-store");
    return c.json({html: modelHtml({...c.req.query(), src}), title: widget.name});
  }
  if (widget.renderer_key === styleQuizKey) return c.json({html: styleQuizHtml(), title: widget.name});
  const entityId = Number(c.req.query("entity_id"));
  if (!Number.isSafeInteger(entityId) || entityId <= 0) throw new ApiError("validation_failed", "Выберите запись");
  c.header("cache-control", "private, no-store");
  const output = await drawDocumentWidget(widget.renderer_key, entityId, design, principal, []);
  if (output.reason === "Недоступна") throw new ApiError("not_found", output.reason);
  return c.json(output);
});

pages.get("/api/v1/entities/:key/card", async (c) => {
  c.header("cache-control", "private, no-store");
  const principal = c.get("principal");
  const found = await resolveEntity(c.req.param("key"), canSeeDrafts(principal));
  if (!found || (!found.isPublished && !canSeeDrafts(principal))) {
    throw new ApiError("not_found", "Сущность не найдена");
  }
  const previewId = c.req.query("preview_layout_id");
  if (previewId !== undefined) {
    requirePermission(principal, "su");
    if (!config.useWidgetLayouts) throw new ApiError("unavailable", "Превью макетов выключено");
    if (!/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(previewId)) {
      throw new ApiError("validation_failed", "Некорректный UID макета");
    }
  }
  const card = await loadPublicCard(found.id, principal);
  if (!card) throw new ApiError("not_found", "Сущность не найдена");
  if (previewId !== undefined) {
    const preview = await readLayout(previewId);
    if (preview?.page_id !== CARD_PAGE_ID) throw new ApiError("not_found", "Макет карточки не найден");
    card.widgetLayout = preview;
  }
  const description = await documentHtml(card, principal);
  const cite = citation({ title: card.title_ru, slug: card.slug, authors: card.authors,
    year: new Date(card.modified_at).getFullYear() });
  // Редактор видит и «Материалы в работе» (0051); остальным раздел не отдаётся.
  const canEdit = !!principal && (principal.permissions.has("edit") || principal.permissions.has("su"));
  const materials = canEdit ? await materialsOf(card.id) : undefined;
  return c.json({ html: cardBody(card, description, cite, await newsExtra(card), materials, undefined, previewId !== undefined), title: `${card.title_ru} — ${site.name}`,
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
    "Disallow: /materials",
    "Disallow: /entity-intake",

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
  const statics = ["/", "/news", "/objects", "/authors", "/lectures", "/about"].map((path) =>
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

const APP_ONLY_TITLES: Record<string, string> = {
  "/login": "Вход", "/parameters": "Параметры", "/parameters/registry": "Справочник параметров", "/robot": "Робот новостей",
  "/materials": "Материалы в работе",
  "/entity-intake": "Стек сущностей",
};
for (const path of ["/login", "/media", "/media/*", "/parameters", "/parameters/registry", "/materials", "/entity-intake", "/entity-intake/*", "/robot", "/robot/*"]) {
  const title = APP_ONLY_TITLES[path.replace("/*", "")] ?? "Медиатека";
  pages.get(path, (c) => appOnly(c, title));
}

/** Есть ли неархивная запись с таким номером, слагом или прежним слагом. */
async function draftExists(key: string): Promise<boolean> {
  const id = /^\d+$/.test(key) ? Number(key) : null;
  const rows = await sql<{ found: boolean }>`
    select exists (
      select 1 from app.entities e
       where e.status <> 'archived'
         and (e.id = ${id} or e.slug = ${key}
              or e.id in (select h.entity_id from app.slug_history h where h.slug = ${key}))
    ) as found
  `;
  return rows[0]?.found ?? false;
}

/**
 * Черновик по прямому адресу. Для поисковика и гостя — 404 без слага и
 * содержания; вошедший редактор получает карточку от скрипта страницы, а до
 * того видит «Загружаем запись…», а не «Страница не найдена».
 */
async function draftPage(c: Context<AppEnv>, entityKey: string) {
  return await render(c, {
    status: 404,
    title: `Запись не опубликована — ${site.name}`,
    publicReader: true,
    entityKey,
    draft: true,
    description: "Запись ещё не опубликована.",
    canonical: null,
    body: layout(
      `<div class="draft-pending"><p class="notice">Загружаем запись…</p></div>` +
        `<div class="draft-closed"><h1>Запись ещё не опубликована</h1>` +
        `<p>Её видят только редакторы. Если вы редактор — войдите.</p>` +
        `<p><a href="/">На главную</a> · <a href="/login">Войти</a></p></div>`,
    ),
  });
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
