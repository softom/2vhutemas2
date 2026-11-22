import { modelPath } from "./modelWidgets.ts";

export const cardSectionNames: Readonly<Record<string,string>> = {
  card_title: "Заголовок карточки", news_navigation: "Листать новости", news_same_day: "Новости за день",
  parameters: "Параметры", links: "Связи", text: "Текст", gallery: "Изображения",
  drawings: "Чертежи", sources: "Источники", mentions: "Упоминания",
  research_materials: "Материалы в работе", citation: "Цитирование", video: "Видео",
};
export function isPageFrame(key: string) {
  return key === "site_menu" || key === "site_footer";
}
export function layoutCapabilities(key: string) {
  if (isPageFrame(key)) return { widths:[4], heights:[1], designs:["default"] };
  return sectionCapabilities(key);
}
export function sectionCapabilities(key: string) {
  if (modelPath(key)) return { widths:[1,2,3], heights:[1], designs:["default"] };
  if (key === "news_compact") return { widths:[1,2,3], heights:[1,2,3], designs:["regular","feature","compact"] };
  if (key === "record_compact") {
    return { widths: [1, 2, 3], heights: [1, 2, 3], designs: ["compact"] };
  }
  return Object.hasOwn(cardSectionNames,key)
    ? { widths:[1,2,3], heights:[1,2,3], designs:["default"] } : undefined;
}
