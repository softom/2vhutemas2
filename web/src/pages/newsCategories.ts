import type { RobotStory } from "../api";

export const NEWS_CATEGORIES = [
  ["architecture", "Архитектура"], ["software", "ПО"], ["ai", "ИИ"],
  ["competitions", "Конкурсы"], ["site", "Материалы сайта"], ["knowledge", "Исследования и знания"],
] as const;
export type NewsCategory = typeof NEWS_CATEGORIES[number][0];
export const CATEGORY_NAMES = Object.fromEntries(NEWS_CATEGORIES);
export function newsCategory(c: Pick<RobotStory, "topic" | "kind" | "competition" | "category">): NewsCategory | "unclassified" {
  if (NEWS_CATEGORIES.some(([id]) => id === c.category)) return c.category as NewsCategory;
  if (c.competition || c.kind === "competition") return "competitions";
  if (c.topic === "neurogeneration") return "ai";
  if (c.kind === "research") return "knowledge";
  if (c.topic === "software") return "software";
  if (c.topic === "architecture") return "architecture";
  return "unclassified";
}
export const VALUE_REASONS: Record<string, string[]> = {
  architecture: ["Сильная архитектурная идея", "Интересное пространственное решение", "Новый конструктивный или материальный приём"],
  software: ["Полезный рабочий процесс", "Автоматизация рутины", "Важная доступная функция"],
  ai: ["Новая возможность проектирования", "Значимый релиз или изменение доступности", "Убедительно подтверждённый результат"],
  competitions: ["Подходит студентам", "Интересная проектная задача", "Важные итоги конкурса"],
  site: ["Полезный новый материал", "Содержательное обновление", "Важное дополнение курса"],
  knowledge: ["Новый обоснованный вывод", "Ценный документ или атрибуция", "Полезно для обучения и понимания"],
  unclassified: ["Полезно аудитории сайта"],
};
export const PROFILE_HEADINGS = ["Общие правила", ...NEWS_CATEGORIES.map(([, title]) => title)];
// Неизвестные разделы и прежний свободный текст сохраняются без потери.
export function splitProfile(value: string): { title: string; body: string }[] {
  const result: { title: string; body: string }[] = [];
  let title = "Общие правила", lines: string[] = [];
  const flush = () => { if (lines.length || result.length) result.push({ title, body: lines.join("\n").trim() }); };
  for (const line of value.split("\n")) {
    const match = line.match(/^## (.+)$/);
    if (match) { flush(); title = match[1]; lines = []; } else lines.push(line);
  }
  flush();
  return result.length ? result : [{ title, body: "" }];
}
export function joinProfile(sections: { title: string; body: string }[]): string {
  return sections.map(s => `## ${s.title}\n${s.body}`).join("\n\n");
}
