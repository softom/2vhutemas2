/**
 * Текст BlockNote в простой HTML для готовых страниц (Р-65).
 *
 * Поисковику и читателю без скриптов нужен смысл, а не оформление редактора:
 * заголовки, абзацы, списки, ссылки, изображения с подписями. Карточка и
 * упоминание записи становятся обычной ссылкой на её постоянный адрес.
 * Неизвестный блок не теряется — от него остаётся его текст.
 */
import { entityPath, escapeHtml, mediaUrl } from "./site.ts";

/**
 * Компонент компактного вида с готовым значением (`app.compact_json`):
 * миниатюра или портрет — с номером файла обложки, параметр — со значением.
 */
export interface CompactItem {
  component: string;
  asset?: string | null;
  parameter?: string;
  value?: string | null;
}

export interface RefTarget {
  slug: string;
  title: string;
  /** Название типа — подпись карточки в тексте. */
  kind?: string;
  /** Компактный вид записи (таблица отображений). */
  compact?: CompactItem[];
}

/**
 * Разбор компактного вида: изображение (и его форма), знак источника,
 * значения параметров. Что показывать, решает тип записи (Схема данных,
 * «Отображение»); каталог, список, карточка в тексте и упоминание
 * различаются только размером.
 */
export function compactParts(compact: CompactItem[] | undefined) {
  const items = compact ?? [];
  const picture = items.find((item) => item.component === "thumbnail" || item.component === "portrait");
  return {
    image: picture?.asset ?? null,
    portrait: picture?.component === "portrait",
    mark: items.some((item) => item.component === "mark"),
    params: items.filter((item) => item.component === "parameter" && item.value).map((item) => String(item.value)),
  };
}

/** Запись строкой: в абзаце и в списке. */
export function compactLine(target: RefTarget, title = target.title): string {
  const parts = compactParts(target.compact);
  const picture = parts.image
    ? `<img class="mention-thumb${parts.portrait ? " portrait" : ""}" src="${escapeHtml(mediaUrl(parts.image, "thumbnail"))}" alt="" loading="lazy" />`
    : parts.mark ? SOURCE_MARK : "";
  const params = parts.params.length ? `<span class="compact-param">, ${escapeHtml(parts.params.join(", "))}</span>` : "";
  return `<a class="entity-mention" href="${escapeHtml(entityPath(target.slug))}">${picture}${escapeHtml(title)}${params}</a>`;
}

/** Запись карточкой в тексте (Р-52): изображение крупно, название поверх. */
function compactCard(target: RefTarget, note: string): string {
  const parts = compactParts(target.compact);
  const shape = parts.portrait ? " portrait" : "";
  const kind = [target.kind ?? "", ...parts.params].filter(Boolean).join(" · ");
  const text = `<div class="entity-card-text"><a href="${escapeHtml(entityPath(target.slug))}">${
    parts.mark ? SOURCE_MARK : ""}${escapeHtml(target.title)}</a>` +
    (kind ? `<div class="entity-card-kind">${escapeHtml(kind)}</div>` : "") +
    (note ? `<div class="entity-card-note">${escapeHtml(note)}</div>` : "") + `</div>`;
  return parts.image
    ? `<div class="entity-card with-cover${shape}"><img src="${escapeHtml(mediaUrl(parts.image, "screen"))}" alt="" loading="lazy" />${text}</div>`
    : `<div class="entity-card${shape}">${text}</div>`;
}

export interface RenderContext {
  /** Опубликованные записи, на которые ссылается текст: номер → адрес. */
  entities: Map<number, RefTarget>;
  /** Файлы, которые можно показать без входа, с автором и источником. */
  publicAssets: Map<string, Attribution>;
}

/** Подпись изображения-цитаты (Р-68): кому приписать и откуда взято. */
export interface Attribution {
  author: string | null;
  source: string | null;
  source_url: string | null;
}

/** «Автор · Источник»; источник — ссылкой наружу, если адрес известен. */
export function creditHtml(credit: Attribution): string {
  const parts: string[] = [];
  if (credit.author) parts.push(escapeHtml(credit.author));
  const url = safeHref(credit.source_url);
  const label = escapeHtml(credit.source || "источник");
  if (url && /^https?:/i.test(url)) {
    parts.push(`<a href="${escapeHtml(url)}" rel="noopener">${label}</a>`);
  } else if (credit.source) {
    parts.push(label);
  }
  return parts.join(" · ");
}

/** Изображение с подписью и обязательной строкой «Автор · Источник». */
export function figureHtml(src: string, caption: string, credit: Attribution | null): string {
  const alt = escapeHtml(caption);
  const lines = [caption ? alt : "", credit ? creditHtml(credit) : ""].filter(Boolean);
  const full = new URL(src);
  full.searchParams.set("variant", "screen");
  return `<figure><a data-gallery href="${escapeHtml(full.href)}"><img src="${escapeHtml(src)}" alt="${alt}" loading="lazy" decoding="async"></a>` +
    (lines.length ? `<figcaption>${lines.join("<br>")}</figcaption>` : "") + `</figure>`;
}

interface Inline {
  type?: string;
  text?: string;
  href?: string;
  styles?: Record<string, unknown>;
  content?: unknown;
  props?: Record<string, unknown>;
}

interface Block {
  type?: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: Block[];
}

/** Тот же лист с загнутым углом, что и в редакторе: знак один на оба показа. */
const SOURCE_MARK =
  '<svg class="source-mark" viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
  '<path d="M4.5 2.5H11l2.5 2.5v8.5h-9z" fill="none" stroke="currentColor" stroke-width="1.3"/>' +
  '<path d="M6.3 6.6h4.2M6.3 9h4.2M6.3 11.4h2.6" stroke="currentColor" stroke-width="1.3"/></svg>';

/**
 * Интерактивная модель встраивается только своя: статичная страница из
 * `/models/` (Р-80). Чужой адрес во фрейме — это чужой код на нашей
 * странице, поэтому всё прочее отбрасывается.
 */
export function modelSrc(src: unknown): string | null {
  const value = String(src ?? "").trim();
  return /^\/models\/[a-z0-9-]+\.html$/.test(value) ? value : null;
}

/** Выделенная рамка модели: во фрейме — модель без обвязки страницы
 *  (`?embed=1`), рядом ссылка на полную страницу; без скриптов рамка
 *  работает как ссылка. */
function modelHtml(props: Record<string, unknown>): string {
  const src = modelSrc(props.src);
  if (!src) return "";
  const title = escapeHtml(String(props.title ?? "") || "Интерактивная модель");
  const caption = escapeHtml(String(props.caption ?? ""));
  const height = Math.min(Math.max(Number(props.height) || 560, 320), 900);
  return `<figure class="model-embed"><div class="model-embed-label">Интерактивная модель · ${title}</div>` +
    `<iframe src="${escapeHtml(src)}?embed=1" title="${title}" loading="lazy" style="height:${height}px"></iframe>` +
    `<figcaption>${caption ? caption + " · " : ""}<a href="${escapeHtml(src)}">Открыть на весь экран</a></figcaption></figure>`;
}

function safeHref(href: unknown): string | null {
  const value = String(href ?? "").trim();
  return /^(https?:|mailto:|\/)/i.test(value) ? value : null;
}

function inline(content: unknown, ctx: RenderContext): string {
  if (typeof content === "string") return escapeHtml(content);
  if (!Array.isArray(content)) return "";
  return content.map((item: Inline) => {
    if (typeof item === "string") return escapeHtml(item);
    if (!item || typeof item !== "object") return "";
    if (item.type === "link") {
      const href = safeHref(item.href);
      const text = inline(item.content, ctx);
      if (!href) return text;
      const external = /^https?:/i.test(href) ? ' rel="noopener"' : "";
      return `<a href="${escapeHtml(href)}"${external}>${text}</a>`;
    }
    // Знак источника: в готовой странице он тоже ведёт к объекту, а
    // обстоятельства цитаты подставляются подсказкой (Р-76).
    if (item.type === "sourceRef") {
      const id = Number(item.props?.entityId);
      const target = ctx.entities.get(id);
      const hint = escapeHtml(
        String(item.props?.note ?? "") || String(item.props?.title ?? "") || target?.title || "",
      );
      // Источник ещё черновик — знак всё равно остаётся: цитата в тексте
      // никуда не делась, просто идти пока некуда. Молча стирать знак хуже:
      // читатель не узнает, что здесь была ссылка на источник.
      if (!target) return `<span class="source-ref" title="${hint}">${SOURCE_MARK}</span>`;
      return `<a class="source-ref" href="${escapeHtml(entityPath(target.slug))}" title="${hint}">` +
        SOURCE_MARK + `</a>`;
    }
    if (item.type === "entityMention") {
      const id = Number(item.props?.entityId);
      const target = ctx.entities.get(id);
      const title = String(item.props?.title || target?.title || "");
      return target ? compactLine(target, title) : escapeHtml(title);
    }
    let html = escapeHtml(item.text ?? "");
    const styles = item.styles ?? {};
    if (styles.code) html = `<code>${html}</code>`;
    if (styles.bold) html = `<strong>${html}</strong>`;
    if (styles.italic) html = `<em>${html}</em>`;
    if (styles.strike) html = `<s>${html}</s>`;
    return html;
  }).join("");
}

function tableHtml(content: unknown, ctx: RenderContext): string {
  const rows = (content as { rows?: { cells?: unknown[] }[] })?.rows ?? [];
  const body = rows.map((row) =>
    `<tr>${(row.cells ?? []).map((cell) => {
      const inner = cell && typeof cell === "object" && !Array.isArray(cell)
        ? (cell as { content?: unknown }).content
        : cell;
      return `<td>${inline(inner, ctx)}</td>`;
    }).join("")}</tr>`
  ).join("");
  return body ? `<table>${body}</table>` : "";
}

function block(item: Block, ctx: RenderContext): string {
  const props = item.props ?? {};
  const children = item.children?.length ? blocks(item.children, ctx) : "";
  switch (item.type) {
    case "heading": {
      // Заголовок страницы — h1 с названием записи; внутри текста уровни ниже.
      const level = Math.min(Math.max(Number(props.level) || 1, 1), 3) + 1;
      return `<h${level}>${inline(item.content, ctx)}</h${level}>${children}`;
    }
    case "quote":
      return `<blockquote>${inline(item.content, ctx)}</blockquote>${children}`;
    case "codeBlock":
      return `<pre><code>${inline(item.content, ctx)}</code></pre>`;
    case "table":
      return tableHtml(item.content, ctx);
    case "entityCard": {
      const target = ctx.entities.get(Number(props.entityId));
      if (!target) return "";
      return compactCard(target, String(props.note ?? ""));
    }
    case "mediaImage": {
      const assetId = String(props.assetId ?? "");
      const caption = String(props.caption ?? "");
      const credit = ctx.publicAssets.get(assetId);
      if (credit) return figureHtml(mediaUrl(assetId), caption, credit);
      return caption ? `<p>${escapeHtml(caption)}</p>` : "";
    }
    case "modelEmbed":
      return modelHtml(props);
    case "image": {
      // Внешняя картинка без автора и источника — не цитата (Р-68):
      // показываем только подпись, если она есть.
      const caption = String(props.caption ?? "");
      return caption ? `<p>${escapeHtml(caption)}</p>` : "";
    }
    default: {
      const text = inline(item.content, ctx);
      return (text ? `<p>${text}</p>` : "") + children;
    }
  }
}

const LISTS: Record<string, string> = {
  bulletListItem: "ul",
  numberedListItem: "ol",
  checkListItem: "ul",
};

/** Подряд идущие пункты списка собираются в один список. */
export function blocks(list: unknown, ctx: RenderContext): string {
  if (!Array.isArray(list)) return "";
  let html = "";
  let openList: string | null = null;
  for (const item of list as Block[]) {
    if (!item || typeof item !== "object") continue;
    const tag = item.type ? LISTS[item.type] : undefined;
    if (tag !== openList) {
      if (openList) html += `</${openList}>`;
      if (tag) html += `<${tag}>`;
      openList = tag ?? null;
    }
    if (tag) {
      const nested = item.children?.length ? blocks(item.children, ctx) : "";
      html += `<li>${inline(item.content, ctx)}${nested}</li>`;
    } else {
      html += block(item, ctx);
    }
  }
  if (openList) html += `</${openList}>`;
  return html;
}

/** Первый абзац с текстом: из него берётся описание страницы. */
export function firstParagraph(list: unknown): string {
  if (!Array.isArray(list)) return "";
  for (const item of list as Block[]) {
    if (item?.type !== "paragraph") continue;
    const text = plain(item.content).trim();
    if (text) return text;
  }
  return "";
}

function plain(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((item: Inline) => {
    if (typeof item === "string") return item;
    if (item?.type === "entityMention") return String(item.props?.title ?? "");
    if (item?.type === "link") return plain(item.content);
    return item?.text ?? "";
  }).join("");
}
