/**
 * Новости на сайте (Р-88, ТЗ «Новости», раздел 6): главная — лента
 * опубликованных записей «Новость», новые сверху; архив `/news`.
 *
 * Страница только показывает: что опубликовано и когда — решают стек
 * редактора и публикатор робота. Порядок — по дню и слоту выхода
 * (`news_release`, `news_release_time`), без них — по дате публикации.
 * Отбор по теме — ссылками `?topic=`: страница целиком готовый HTML,
 * без приложения (Р-65).
 */
import { sql } from "./db.ts";
import { escapeHtml as e, entityPath } from "./site.ts";
import { type CompactItem, compactParts, compactPicture, firstParagraph } from "./blocksHtml.ts";

export interface NewsRow {
  id: number;
  slug: string;
  title_ru: string;
  compact: CompactItem[];
  release_date: string | null;
  release_time: string | null;
  published_at: string | null;
  topics: { code: string; title: string }[];
  body: unknown;
  source_title: string | null;
}

export interface Topic {
  code: string;
  title: string;
}

/** Новость в порядке ленты — лёгкие поля, без миниатюры и текста. */
export interface NewsLite {
  id: number;
  slug: string;
  title_ru: string;
  release_date: string | null;
  release_time: string | null;
  published_at: string | null;
}

/**
 * Лента в порядке выхода: значения читаются один раз (read_values собирает
 * все значения всех записей — вызов на каждую новость стоил минуты), порядок
 * считается по лёгким полям. `topic` — код варианта «Темы новости».
 */
export async function newsOrder(topic: string | null): Promise<NewsLite[]> {
  return await sql<NewsLite>`
    with v as materialized (
      select i.entity_id, p.code, iv.text_value, iv.date_start_year as y, iv.date_start_month as m,
             iv.date_start_day as d, o.code as option_code, i.sort_order as i_sort, iv.sort_order as v_sort
        from app.read_values(false) iv
        join app.read_indicators(false) i on i.id = iv.indicator_id and i.is_current
        join app.parameters p on p.id = iv.parameter_id
                             and p.code in ('news_release', 'news_release_time', 'news_topic')
        left join app.parameter_options o on o.id = iv.option_id),
    n as materialized (
      select e.id, e.slug, e.title_ru, e.published_revision_id
        from app.read_entities(false) e
       where e.is_published and e.type_id in (select app.entity_type_subtree('news')))
    select n.id, n.slug, n.title_ru,
           (select format('%s-%s-%s', v.y, lpad(coalesce(v.m, 1)::text, 2, '0'), lpad(coalesce(v.d, 1)::text, 2, '0'))
              from v where v.entity_id = n.id and v.code = 'news_release' and v.y is not null
             order by v.i_sort, v.v_sort limit 1) as release_date,
           (select v.text_value from v where v.entity_id = n.id and v.code = 'news_release_time'
             order by v.i_sort, v.v_sort limit 1) as release_time,
           (select r.created_at from app.revisions r where r.id = n.published_revision_id) as published_at
      from n
     where ${topic}::text is null
        or exists (select 1 from v where v.entity_id = n.id and v.code = 'news_topic' and v.option_code = ${topic})
     order by release_date desc nulls last, release_time desc nulls last, published_at desc nulls last, n.id desc`;
}

/**
 * Опубликованные новости, свежие сверху: страница ленты. Тяжёлое — миниатюра,
 * текст, источник, темы — только для показываемых. Возвращает на одну больше
 * `limit`, чтобы знать, есть ли продолжение.
 */
export async function loadNews(topic: string | null, limit: number, offset: number): Promise<NewsRow[]> {
  const order = (await newsOrder(topic)).slice(offset, offset + limit + 1);
  if (order.length === 0) return [];
  const ids = order.map((row) => Number(row.id));
  const details = await sql<{ id: number; compact: CompactItem[]; topics: NewsRow["topics"]; body: unknown; source_title: string | null }>`
    with v as materialized (
      select i.entity_id, o.code, o.title_ru, o.sort_order
        from app.read_values(false) iv
        join app.read_indicators(false) i on i.id = iv.indicator_id and i.is_current
        join app.parameters p on p.id = iv.parameter_id and p.code = 'news_topic'
        join app.parameter_options o on o.id = iv.option_id
       where i.entity_id = any(${ids}::bigint[]))
    select e.id, app.compact_json(e.id, false) as compact,
           coalesce((select jsonb_agg(jsonb_build_object('code', v.code, 'title', v.title_ru) order by v.sort_order)
                       from v where v.entity_id = e.id), '[]'::jsonb) as topics,
           (select r.snapshot->'body_json' from app.revisions r where r.id = e.published_revision_id) as body,
           (select s->>'title' from jsonb_array_elements(app.sources_json(e.id, false)) s limit 1) as source_title
      from app.entities e
     where e.id = any(${ids}::bigint[])`;
  const byId = new Map(details.map((row) => [Number(row.id), row]));
  return order.map((row) => {
    const more = byId.get(Number(row.id));
    return { ...row, compact: more?.compact ?? [], topics: more?.topics ?? [], body: more?.body ?? null,
      source_title: more?.source_title ?? null };
  });
}

/** Темы для кнопок отбора — варианты параметра «Тема новости» (данные, не код). */
export async function newsTopics(): Promise<Topic[]> {
  return await sql<Topic>`
    select o.code, o.title_ru as title
      from app.parameter_options o join app.parameters p on p.id = o.parameter_id
     where p.code = 'news_topic'
     order by o.sort_order, o.title_ru`;
}

/** Соседи новости в ленте — для «Раньше / Позже» на её странице. */
export async function newsNeighbours(id: number): Promise<{ before: NewsLite | null; after: NewsLite | null; sameDay: NewsLite[] }> {
  // Соседям хватает лёгкого порядка ленты: без миниатюр и текстов.
  const all = await newsOrder(null);
  const index = all.findIndex((row) => Number(row.id) === id);
  if (index < 0) return { before: null, after: null, sameDay: [] };
  const day = all[index].release_date;
  return {
    after: all[index - 1] ?? null,
    before: all[index + 1] ?? null,
    sameDay: day ? all.filter((row) => row.release_date === day && Number(row.id) !== id) : [],
  };
}

const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const WEEKDAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];

export function dayTitle(iso: string): { title: string; weekday: string } {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return { title: `${d} ${MONTHS[m - 1]}`, weekday: WEEKDAYS[date.getUTCDay()] };
}

/** День новости: выход, иначе дата публикации по Москве. */
export function newsDay(row: NewsLite): string | null {
  if (row.release_date) return row.release_date;
  if (!row.published_at) return null;
  return new Date(row.published_at).toLocaleDateString("sv-SE", { timeZone: "Europe/Moscow" });
}

function todayIso(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Moscow" });
}

function lead(row: NewsRow): string {
  return firstParagraph(row.body);
}

/** Тема новости — своим цветом (класс по коду варианта; цвета — в стилях). */
export function topicHtml(code: string | null | undefined, title: string): string {
  const cls = code && /^[a-z0-9_-]+$/.test(code) ? ` t-${code}` : "";
  return `<span class="news-topic${cls}"><span class="sq"></span>${e(title)}</span>`;
}

function kicker(row: NewsRow): string {
  const topic = row.topics.map((t) => topicHtml(t.code, t.title)).join("");
  return `<div class="kick">${topic || "Новость"}<span class="sl">//</span>` +
    (row.source_title ? `<span class="news-src">${e(row.source_title)}</span>` : "") + `</div>`;
}

function picture(row: NewsRow, large: boolean): string {
  const view = compactParts(row.compact);
  const url = compactPicture(view, large ? "screen" : "thumbnail");
  // Нет снимка — нет и места под него: заглушка во всю ширину тяжелее пустоты.
  return url
    ? `<a class="news-pic" href="${e(entityPath(row.slug))}" tabindex="-1" aria-hidden="true"><img src="${e(url)}" alt="" loading="lazy" /></a>`
    : "";
}

/** Одна новость в ленте: первая — крупно, остальные — строкой. */
function itemHtml(row: NewsRow, large: boolean): string {
  const text = lead(row);
  const main = large
    ? `${picture(row, true)}${kicker(row)}<h2><a href="${e(entityPath(row.slug))}">${e(row.title_ru)}</a></h2>` +
      (text ? `<p class="news-lead">${e(text)}</p>` : "")
    : `<div class="news-row${picture(row, false) ? "" : " no-pic"}">${picture(row, false)}<div class="news-body">${kicker(row)}` +
      `<h3><a href="${e(entityPath(row.slug))}">${e(row.title_ru)}</a></h3>` +
      (text ? `<p class="news-lead">${e(text)}</p>` : "") + `</div></div>`;
  const time = row.release_time ? `<div class="news-time">${e(row.release_time)}</div>` : "";
  return `<article class="news-item${large ? " is-large" : ""}"><div class="news-main">${main}</div>` +
    `<aside class="news-side">${time}</aside></article>`;
}

export interface FeedOptions {
  title: string;
  lead: string;
  path: string;
  topic: string | null;
  topics: Topic[];
  page: number;
  hasMore: boolean;
  today: NewsLite[];
}

/** Лента новостей: шапка с темами и днём, дни с крупной датой, «Раньше». */
export function newsFeedHtml(rows: NewsRow[], opts: FeedOptions): string {
  const link = (topic: string | null, page = 1) => {
    const params = new URLSearchParams();
    if (topic) params.set("topic", topic);
    if (page > 1) params.set("page", String(page));
    const query = params.toString();
    return `${opts.path}${query ? `?${query}` : ""}`;
  };
  const chips = [{ code: null as string | null, title: "Все" }, ...opts.topics].map((t) => {
    const on = (t.code ?? null) === opts.topic;
    const cls = t.code && /^[a-z0-9_-]+$/.test(t.code) ? ` t-${t.code}` : "";
    return `<a class="news-chip${cls}${on ? " on" : ""}" href="${e(link(t.code))}"${on ? ' aria-current="page"' : ""}>${t.code ? '<span class="sq"></span>' : ""}${e(t.title)}</a>`;
  }).join("");
  const today = todayIso();
  const todayList = opts.today.length
    ? `<dl class="news-today">${opts.today.map((row) =>
      `<dt>${e(row.release_time ?? "")}</dt><dd><a href="${e(entityPath(row.slug))}">${e(row.title_ru)}</a></dd>`).join("")}</dl>`
    : `<p class="news-empty-day">Сегодня новостей ещё нет.</p>`;
  const head = `<section class="news-head"><div class="news-head-main"><div class="news-title">` +
    `<h1>${e(opts.title)}</h1><p class="sub">${e(opts.lead)}</p></div>` +
    `<nav class="news-chips" aria-label="Тема">${chips}</nav></div>` +
    `<aside class="news-head-side"><div class="kick"><span class="sq"></span>Сегодня, ${e(dayTitle(today).title)}</div>${todayList}</aside></section>`;

  if (rows.length === 0) {
    return head + `<p class="news-none">${opts.topic ? "По этой теме новостей пока нет." :
      "Новости появятся здесь, как только выйдет первая. Пока — разделы сайта: " +
      '<a href="/objects">Проекты</a>, <a href="/authors">Авторы</a>, <a href="/lectures">Лекции</a>.'}</p>`;
  }

  const parts: string[] = [];
  let currentDay: string | null | undefined;
  rows.forEach((row, index) => {
    const day = newsDay(row);
    if (day !== currentDay) {
      currentDay = day;
      if (day) {
        const { title, weekday } = dayTitle(day);
        parts.push(`<h2 class="news-day"><span>${e(title)}</span><span class="news-weekday">${e(weekday)}</span></h2>`);
      }
    }
    parts.push(itemHtml(row, index === 0 && opts.page === 1));
  });
  const more = opts.hasMore
    ? `<a class="news-more" href="${e(link(opts.topic, opts.page + 1))}" rel="next">Раньше</a>` : "";
  const back = opts.page > 1
    ? `<a class="news-archive" href="${e(link(opts.topic, opts.page - 1))}" rel="prev">← Позже</a>`
    : `<a class="news-archive" href="/news">Архив новостей →</a>`;
  return head + `<div class="news-feed">${parts.join("")}</div><div class="news-pager">${more}${back}</div>`;
}

/** «Раньше / Позже» и «Ещё за этот день» на странице новости. */
export function newsNavHtml(nav: { before: NewsLite | null; after: NewsLite | null }): string {
  const cell = (row: NewsLite | null, label: string, cls: string) => {
    if (!row) return `<span class="${cls} is-empty"></span>`;
    const day = newsDay(row);
    const when = [day ? dayTitle(day).title : "", row.release_time ?? ""].filter(Boolean).join(", ");
    return `<a class="${cls}" href="${e(entityPath(row.slug))}"><span class="news-flip-when">${e(label)}${when ? ` · ${e(when)}` : ""}</span>` +
      `<span class="news-flip-title">${e(row.title_ru)}</span></a>`;
  };
  return `<nav class="news-flip" aria-label="Листать новости" data-news-flip>` +
    cell(nav.before, "← Раньше", "news-flip-before") + cell(nav.after, "Позже →", "news-flip-after") + `</nav>`;
}

export function sameDayHtml(rows: NewsLite[], day: string | null): string {
  if (rows.length === 0 || !day) return "";
  return `<div class="news-sameday"><div class="kick">Ещё ${e(dayTitle(day).title)}</div><ul>${
    rows.map((row) => `<li><span class="news-time-sm">${e(row.release_time ?? "")}</span><a href="${e(entityPath(row.slug))}">${e(row.title_ru)}</a></li>`).join("")
  }</ul></div>`;
}
