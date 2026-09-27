/**
 * Текст BlockNote в простой HTML для готовых страниц (Р-65).
 *
 * Поисковику и читателю без скриптов нужен смысл, а не оформление редактора:
 * заголовки, абзацы, списки, ссылки, изображения с подписями. Карточка и
 * упоминание записи становятся обычной ссылкой на её постоянный адрес.
 * Неизвестный блок не теряется — от него остаётся его текст.
 */
import { entityPath, escapeHtml, mediaUrl } from "./site.ts";

export interface RefTarget {
  slug: string;
  title: string;
}

export interface RenderContext {
  /** Опубликованные записи, на которые ссылается текст: номер → адрес. */
  entities: Map<number, RefTarget>;
  /** Файлы, которые можно показать без входа. */
  publicAssets: Set<string>;
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
    if (item.type === "entityMention") {
      const id = Number(item.props?.entityId);
      const target = ctx.entities.get(id);
      const title = escapeHtml(item.props?.title || target?.title || "");
      return target ? `<a href="${escapeHtml(entityPath(target.slug))}">${title}</a>` : title;
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

function figure(src: string, caption: string): string {
  const alt = escapeHtml(caption);
  return `<figure><img src="${escapeHtml(src)}" alt="${alt}" loading="lazy">` +
    (caption ? `<figcaption>${alt}</figcaption>` : "") + `</figure>`;
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
      const note = props.note ? ` — ${escapeHtml(props.note)}` : "";
      return `<p><a href="${escapeHtml(entityPath(target.slug))}">${
        escapeHtml(target.title)
      }</a>${note}</p>`;
    }
    case "mediaImage": {
      const assetId = String(props.assetId ?? "");
      const caption = String(props.caption ?? "");
      if (ctx.publicAssets.has(assetId)) return figure(mediaUrl(assetId), caption);
      return caption ? `<p>${escapeHtml(caption)}</p>` : "";
    }
    case "image": {
      const src = safeHref(props.url);
      return src ? figure(src, String(props.caption ?? "")) : "";
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
