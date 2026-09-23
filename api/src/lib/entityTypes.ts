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
