/**
 * Дерево типов записей (Р-37).
 *
 * Вид записи — верхняя ветвь дерева, а не отдельное понятие. Прежние коды
 * видов остаются псевдонимами корневых ветвей: сценарии наполнения и ссылки,
 * выданные до перехода, продолжают работать.
 */

/** Прежний код вида → код корневой ветви. */
export const LEGACY_KIND_TO_ROOT: Record<string, string> = {
  person: "who",
  object: "what",
  period: "when",
};

/** Код корневой ветви → прежний код вида, для ответов старым клиентам. */
export const ROOT_TO_LEGACY_KIND: Record<string, string> = {
  who: "person",
  what: "object",
  when: "period",
};

/** Код типа для отбора: прежний вид принимается наравне с типом. */
export function resolveTypeCode(
  type: string | null | undefined,
  kind: string | null | undefined,
): string | null {
  if (type) return type;
  if (kind) return LEGACY_KIND_TO_ROOT[kind] ?? kind;
  return null;
}

/**
 * Ветви, которых нет в общем каталоге «Всё» и в его кнопках отбора: тексты
 * «О проекте» живут в своём разделе, материалы (изображения, документы) — в
 * медиатеке и карточках (Р-84). Одно правило для API, готовых страниц и
 * клиента — клиент получает его в `capabilities.catalog_hidden_roots`.
 */
export const CATALOG_HIDDEN_ROOTS = ["project_pages", "materials", "news"];

/**
 * Группы кнопок отбора в разделе каталога (2026-10-17: «фильтр ломает дизайн
 * и неудобный — сгруппировать и сделать двухуровневым»). Первый ряд — группы,
 * второй — типы выбранной группы. Это раскладка интерфейса, а не дерево
 * типов: тип остаётся в своей ветви. Одна раскладка для готовой страницы и
 * клиента (`capabilities.catalog_groups`). Тип, не попавший ни в одну группу,
 * клиент показывает в группе «Прочее».
 */
export const CATALOG_GROUPS: Record<string, { code: string; title_ru: string; types: string[] }[]> = {
  what: [
    { code: "built", title_ru: "Постройки и проекты",
      types: ["architecture_object", "urban_concept", "environment_object", "study_work"] },
    { code: "competitions", title_ru: "Конкурсы и события", types: ["competition", "competition_entry", "event"] },
    { code: "ideas", title_ru: "Идеи и тексты", types: ["theory_concept", "memorandum", "book", "article", "web_page"] },
    { code: "media", title_ru: "Медиа и искусство", types: ["video", "film", "music", "performance"] },
  ],
};
