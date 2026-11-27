/**
 * Человеческие названия вариантов оформления (Р6, этап 7).
 *
 * Технические коды (`default`, `expanded`) читателю ничего не говорят: в
 * редакторе макета вариант должен называться так же, как режим в стандарте
 * «Вх²» § 1 — «Компактная», «Раскрытая». Название приходит вместе с
 * контрактом виджета; клиент знает стандартные имена режимов и использует
 * их, когда сервер не прислал своего названия.
 */

/** Имена режимов стандарта «Вх²» § 1 и принятые в проекте коды. */
const standardTitles: Readonly<Record<string, string>> = {
  empty: "Нет данных",
  compact: "Компактная",
  expanded: "Раскрытая",
  popup: "Поп-ап — полная",
};

/** Свои названия вариантов отдельных виджетов. */
const widgetTitles: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  // У «Стилистических решений» код `default` — это компактный режим (Р6).
  style_analysis: { default: "Компактная", expanded: "Раскрытая" },
};

/**
 * Названия вариантов оформления виджета: свои названия виджета, иначе —
 * имя режима стандарта, иначе — сам код (чтобы не остаться без подписи).
 */
export function designTitles(key: string, designs: string[]): Record<string, string> {
  const own = widgetTitles[key] ?? {};
  const titles: Record<string, string> = {};
  for (const code of designs) titles[code] = own[code] ?? standardTitles[code] ?? code;
  return titles;
}
