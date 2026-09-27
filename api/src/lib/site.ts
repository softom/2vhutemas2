/**
 * Сайт глазами поисковика и читателя со ссылкой (решение Р-63).
 *
 * Адреса, ссылки для цитирования и разметка общие для готового HTML,
 * который API отдаёт по адресам страниц, и для ответа карточки клиенту:
 * у одной записи не может быть двух разных «как цитировать».
 */

function optional(name: string, fallback: string): string {
  const value = Deno.env.get(name);
  return value && value.trim() !== "" ? value.trim() : fallback;
}

export const site = {
  /** Внешний адрес сайта без косой черты на конце: из него строятся все ссылки. */
  url: optional("SITE_URL", "https://2vhutemas.ru").replace(/\/+$/, ""),
  name: "2ВХУТЕМАС",
  /** Собранная страница клиента: в неё вкладывается готовое содержимое. */
  indexHtml: optional("WEB_INDEX_HTML", "/web/index.html"),
  /**
   * Ключ IndexNow. Не секрет — он по правилам протокола лежит на сайте
   * открытым файлом, — но и не часть кода: живёт в настройках сервера.
   * Пусто — уведомления поисковиков выключены.
   */
  indexNowKey: optional("INDEXNOW_KEY", ""),
  description:
    "Учебный проект курса «Квантовая архитектура»: объекты культуры, их авторы и лекции, " +
    "связанные между собой обоснованными связями.",
} as const;

/** Постоянный адрес записи. Слаг читается, номер записи держит его на месте. */
export function entityPath(slug: string): string {
  return `/entities/${slug}`;
}

export function absolute(path: string): string {
  return `${site.url}${path}`;
}

/** Файл медиатеки, доступный без входа: для og:image и изображений в разметке. */
export function mediaUrl(assetId: string, variant: "screen" | "thumbnail" = "screen"): string {
  return absolute(`/api/v1/media/${assetId}/file?variant=${variant}`);
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Описание для поисковика: первые фразы текста, не длиннее 200 знаков. */
export function summary(text: string | null | undefined, limit = 200): string {
  const plain = (text ?? "").replace(/\s+/g, " ").trim();
  if (plain.length <= limit) return plain;
  const cut = plain.slice(0, limit);
  const sentence = cut.lastIndexOf(". ");
  if (sentence > limit * 0.5) return cut.slice(0, sentence + 1);
  const space = cut.lastIndexOf(" ");
  return `${cut.slice(0, space > 0 ? space : limit).replace(/[,;:—–-]+$/, "")}…`;
}

const MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

/** Дата по Москве: сайт русский, и «дата обращения» считается по его времени. */
function moscowParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

export interface CitationInput {
  title: string;
  slug: string;
  /** Подписи авторов материала — в порядке, в каком их ставит проект. */
  authors: string[];
  /** Когда запись опубликована или последний раз изменена. */
  year: number | null;
  accessed?: Date;
}

export interface Citation {
  url: string;
  accessed: string;
  gost: string;
  apa: string;
}

/**
 * Готовые ссылки для курсовой и статьи.
 *
 * ГОСТ Р 7.0.100-2018, описание части сайта: заглавие / сведения об
 * ответственности // заглавие сайта : [сайт]. – год. – URL (дата обращения).
 * APA 7 для страницы, которая может меняться: автор (год). Заглавие.
 * Сайт. Дата обращения, URL.
 */
export function citation(input: CitationInput): Citation {
  const url = absolute(entityPath(input.slug));
  const now = moscowParts(input.accessed ?? new Date());
  const dd = String(now.day).padStart(2, "0");
  const mm = String(now.month).padStart(2, "0");
  const accessed = `${dd}.${mm}.${now.year}`;
  const year = input.year ?? now.year;
  const authors = input.authors.filter(Boolean);

  const responsibility = authors.length > 0 ? ` / ${authors.join(", ")}` : "";
  const gost = `${input.title}${responsibility} // ${site.name} : [сайт]. – ${year}. – ` +
    `URL: ${url} (дата обращения: ${accessed}).`;

  const apaAuthor = authors.length > 0 ? authors.join(", ") : site.name;
  const apa = `${apaAuthor}. (${year}). ${input.title}. ${site.name}. ` +
    `Дата обращения: ${now.day} ${MONTHS[now.month - 1]} ${now.year} г., ${url}`;

  return { url, accessed, gost, apa };
}
