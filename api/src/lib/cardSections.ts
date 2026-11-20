import { modelPath } from "./modelWidgets.ts";

export const cardSectionNames: Readonly<Record<string,string>> = {
  parameters: "Параметры", links: "Связи", text: "Текст", gallery: "Изображения",
  drawings: "Чертежи", sources: "Источники", mentions: "Упоминания",
  citation: "Цитирование", video: "Видео",
};
export function sectionCapabilities(key: string) {
  if (modelPath(key)) return { widths:[1,2,3], heights:[1], designs:["default"] };
  if (key === "news_compact" || key === "record_compact") {
    return { widths: [1, 2, 3], heights: [1, 2, 3], designs: ["compact"] };
  }
  return Object.hasOwn(cardSectionNames,key)
    ? { widths:[1,2,3], heights:[1,2,3], designs:["default"] } : undefined;
}
