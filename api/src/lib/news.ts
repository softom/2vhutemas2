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

/**
 * Опубликованные новости, свежие сверху. `topic` — код варианта «Темы новости».
 * Возвращает на одну больше `limit`, чтобы знать, есть ли продолжение.
 */
export async function loadNews(topic: string | null, limit: number, offset: number): Promise<NewsRow[]> {
  return await sql<NewsRow>`
    select e.id, e.slug, e.title_ru, app.compact_json(e.id, false) as compact,
           rd.release_date, rt.release_time,
           (select r.created_at from app.revisions r where r.id = e.published_revision_id) as published_at,
           coalesce((select jsonb_agg(jsonb_build_object('code', o.code, 'title', o.title_ru) order by o.sort_order)
                       from app.read_values(false) iv
                       join app.read_indicators(false) i on i.id = iv.indicator_id
                       join app.parameters p on p.id = iv.parameter_id
                       join app.parameter_options o on o.id = iv.option_id
                      where i.entity_id = e.id and i.is_current and p.code = 'news_topic'), '[]'::jsonb) as topics,
           (select r.snapshot->'body_json' from app.revisions r where r.id = e.published_revision_id) as body,
           (select s->>'title' from jsonb_array_elements(app.sources_json(e.id, false)) s limit 1) as source_title
      from app.read_entities(false) e
      left join lateral (
          select format('%s-%s-%s', iv.date_start_year, lpad(coalesce(iv.date_start_month, 1)::text, 2, '0'),
                        lpad(coalesce(iv.date_start_day, 1)::text, 2, '0')) as release_date
            from app.read_values(false) iv
            join app.read_indicators(false) i on i.id = iv.indicator_id
            join app.parameters p on p.id = iv.parameter_id
           where i.entity_id = e.id and i.is_current and p.code = 'news_release' and iv.date_start_year is not null
           order by i.sort_order, iv.sort_order limit 1) rd on true
      left join lateral (
          select iv.text_value as release_time
            from app.read_values(false) iv
            join app.read_indicators(false) i on i.id = iv.indicator_id
            join app.parameters p on p.id = iv.parameter_id
           where i.entity_id = e.id and i.is_current and p.code = 'news_release_time'
           order by i.sort_order, iv.sort_order limit 1) rt on true
     where e.is_published
       and e.type_id in (select app.entity_type_subtree('news'))
       and (${topic}::text is null or exists (
             select 1 from app.read_values(false) iv
               join app.read_indicators(false) i on i.id = iv.indicator_id
               join app.parameters p on p.id = iv.parameter_id
               join app.parameter_options o on o.id = iv.option_id
              where i.entity_id = e.id and i.is_current and p.code = 'news_topic' and o.code = ${topic}))
     order by rd.release_date desc nulls last, rt.release_time desc nulls last, published_at desc nulls last, e.id desc
     limit ${limit + 1} offset ${offset}`;
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
export async function newsNeighbours(id: number): Promise<{ before: NewsRow | null; after: NewsRow | null; sameDay: NewsRow[] }> {
  const all = await loadNews(null, 500, 0);
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
export function newsDay(row: NewsRow): string | null {
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

function kicker(row: NewsRow): string {
  const topic = row.topics.map((t) => e(t.title)).join(" · ");
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
  today: NewsRow[];
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
    return `<a class="news-chip${on ? " on" : ""}" href="${e(link(t.code))}"${on ? ' aria-current="page"' : ""}>${e(t.title)}</a>`;
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
export function newsNavHtml(nav: { before: NewsRow | null; after: NewsRow | null }): string {
  const cell = (row: NewsRow | null, label: string, cls: string) => {
    if (!row) return `<span class="${cls} is-empty"></span>`;
    const day = newsDay(row);
    const when = [day ? dayTitle(day).title : "", row.release_time ?? ""].filter(Boolean).join(", ");
    return `<a class="${cls}" href="${e(entityPath(row.slug))}"><span class="news-flip-when">${e(label)}${when ? ` · ${e(when)}` : ""}</span>` +
      `<span class="news-flip-title">${e(row.title_ru)}</span></a>`;
  };
  return `<nav class="news-flip" aria-label="Листать новости" data-news-flip>` +
    cell(nav.before, "← Раньше", "news-flip-before") + cell(nav.after, "Позже →", "news-flip-after") + `</nav>`;
}

export function sameDayHtml(rows: NewsRow[], day: string | null): string {
  if (rows.length === 0 || !day) return "";
  return `<div class="news-sameday"><div class="kick">Ещё ${e(dayTitle(day).title)}</div><ul>${
    rows.map((row) => `<li><span class="news-time-sm">${e(row.release_time ?? "")}</span><a href="${e(entityPath(row.slug))}">${e(row.title_ru)}</a></li>`).join("")
  }</ul></div>`;
}
