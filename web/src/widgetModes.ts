/**
 * Каркас режимов виджетов (стандарт «Вх²» § 1, Р4, Р21).
 *
 * Единый системный `<dialog>` на страницу: поп-ап открывается только по
 * действию читателя, фокус уходит внутрь, выход — по Esc и по кнопке, после
 * закрытия фокус возвращается на элемент, который открыл.
 */
import { request } from "./api";

let opener: HTMLElement | null = null;

/** Диалог на страницу — один и тот же для всех виджетов. */
function widgetDialog(): HTMLDialogElement {
  const existing = document.querySelector<HTMLDialogElement>("dialog.widget-dialog");
  if (existing) return existing;
  const element = document.createElement("dialog");
  element.className = "widget-dialog";
  element.addEventListener("close", () => {
    const target = opener;
    opener = null;
    target?.focus();
  });
  document.body.append(element);
  return element;
}

/** Открыть поп-ап с содержимым: фокус внутри, Esc и кнопка закрывают. */
export function openWidgetDialog(
  html: string,
  label: string,
  trigger?: HTMLElement | null,
): HTMLDialogElement {
  const element = widgetDialog();
  if (element.open) element.close();
  opener = trigger ?? null;
  element.setAttribute("aria-label", label);
  element.innerHTML =
    `<div class="widget-dialog-bar"><button type="button" data-close>Закрыть</button></div>${html}`;
  element.querySelector("[data-close]")?.addEventListener("click", () => element.close());
  element.showModal();
  element.querySelector<HTMLElement>("[data-close]")?.focus();
  return element;
}

/**
 * Часть виджета по требованию (Р22): сервер отдаёт фрагмент разметки,
 * а не страницу; гость и редактор получают одну и ту же проекцию.
 *
 * Запрос идёт через общий клиент API: он прикладывает заголовок
 * Authorization, и редактор видит ту же проекцию, что и в карточке, — со
 * черновиками. Отдельный запрос без заголовка терял бы режим просмотра.
 */
export async function loadWidgetPart(path: string): Promise<string> {
  const data = await request<{ html?: string }>(path, {
    headers: { accept: "application/json" },
  });
  return typeof data.html === "string" ? data.html : "";
}

/**
 * Название варианта оформления (Р6): сервер присылает свои названия, а клиент
 * знает имена режимов стандарта «Вх²» § 1. Кода без названия не остаётся —
 * виден сам код.
 */
const modeTitles: Record<string, string> = {
  empty: "Нет данных",
  compact: "Компактная",
  expanded: "Раскрытая",
  popup: "Поп-ап — полная",
};

export function designTitle(code: string, titles?: Record<string, string> | null): string {
  return titles?.[code] ?? modeTitles[code] ?? code;
}
