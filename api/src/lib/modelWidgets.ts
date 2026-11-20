/** Only model pages shipped with the site can be called by a model widget. */
export const modelPages: Readonly<Record<string, string>> = {
  model_proportion: "Пропорция: часть и целое",
  model_hogarth: "Линия красоты Хогарта",
  model_chain: "Цепь и перевёрнутая арка",
  model_arch: "Арка из семи камней",
  model_catalan: "Каталонский свод",
  model_grid: "Прямая и поле",
  model_casteljau: "Алгоритм де Кастельжо",
  model_nurbs: "От прямой к NURBS",
  model_zones: "Профили площадей",
  model_cologne: "Кёльнский собор",
};
export function modelPath(key: string) {
  return Object.hasOwn(modelPages, key) ? "/models/" + key.slice(6) + ".html" : null;
}
