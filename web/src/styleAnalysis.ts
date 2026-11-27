/**
 * «Стилистические решения»: поп-ап полного вида и подгрузка частей.
 *
 * Первичный HTML карточки лёгкий: в нём нет ни вкладок «Близкие объекты»
 * и «Источники», ни подсказок по строкам профиля (Р22). Они приходят по
 * требованию, когда читатель их запросил: поп-ап открывается по кнопке
 * «Исследовать» (Р4, Р6), вкладки — при выборе, подсказка — при наведении,
 * фокусе или касании строки (Р19).
 *
 * Экземпляров виджета на странице может быть несколько: каждый подключается
 * отдельно, со своим адресом подгрузки и своими обработчиками (Р13, Р14).
 */
import { loadWidgetPart, openWidgetDialog } from "./widgetModes";

/** Панель полного вида по её признаку. */
function part(html: string, name: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content.querySelector(`[data-style-pane="${name}"]`)?.innerHTML ?? "";
}

/**
 * Подсказка строки: адрес строки — связь, фаза и часть объекта (Р15).
 * Подсказка показывает ровно те свидетельства, из которых получена оценка
 * строки, — столько же, сколько показывает полный вид.
 */
function hintUrl(base: string, trigger: HTMLElement): string {
  const params = new URLSearchParams({
    part: "hint",
    link: trigger.dataset.styleHint ?? "",
    phase: trigger.dataset.stylePhase ?? "",
    zone: trigger.dataset.styleZone ?? "",
  });
  return `${base}?${params.toString()}`;
}

/** Один экземпляр виджета: свои вкладки, своя кнопка и свои подсказки. */
function mountInstance(widget: HTMLElement) {
  const uid = widget.dataset.styleUid ?? "";
  if (!uid) return;
  // Путь без префикса API: его подставляет общий клиент вместе с токеном.
  const base = `/entities/${uid}/style-analysis`;
  let popup: string | null = null;
  const loadPopup = async (): Promise<string> => {
    popup ??= await loadWidgetPart(`${base}?part=popup`);
    return popup;
  };

  // Поп-ап полного вида — по действию читателя, не при загрузке страницы (Р6).
  widget.querySelector<HTMLButtonElement>("[data-style-research]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    try {
      openWidgetDialog(await loadPopup(), "Стилистический анализ", button);
    } catch {
      button.textContent = "Не удалось открыть";
    } finally {
      button.disabled = false;
    }
  });

  // Вкладки «Близкие объекты» и «Источники» — по требованию (Р22).
  widget.querySelectorAll<HTMLInputElement>("[data-style-tab]").forEach((input) => {
    input.addEventListener("change", async () => {
      if (!input.checked) return;
      const name = input.dataset.styleTab ?? "";
      if (name === "profile") return;
      const pane = widget.querySelector<HTMLElement>(`[data-style-pane="${name}"]`);
      if (!pane || pane.dataset.loaded === "true") return;
      pane.innerHTML = '<p class="style-loading">Загружаем…</p>';
      try {
        pane.innerHTML = part(await loadPopup(), name);
        pane.dataset.loaded = "true";
      } catch {
        pane.innerHTML = '<p class="hint">Не удалось загрузить.</p>';
      }
    });
  });

  // Подсказка строки — по требованию (Р22): свидетельства приходят по адресу
  // строки. Триггер — интерактивный элемент строки (процент поддержки или
  // плашка отрицания), а сама плашка встаёт в строку: её правила ждут
  // прямого потомка строки (Р24).
  widget.querySelectorAll<HTMLElement>("[data-style-hint]").forEach((trigger) => {
    const holder = trigger.closest<HTMLElement>(".style-score, .style-objection") ?? trigger;
    const load = async () => {
      if (trigger.dataset.hintLoaded === "true") return;
      const hintId = trigger.dataset.styleHintId ?? "";
      if (!hintId) return;
      const html = await loadWidgetPart(hintUrl(base, trigger));
      if (!html) return;
      const template = document.createElement("template");
      template.innerHTML = html;
      const tip = template.content.firstElementChild;
      if (!tip) return;
      tip.id = hintId;
      holder.append(tip);
      trigger.setAttribute("aria-describedby", hintId);
      trigger.dataset.hintLoaded = "true";
    };
    const ask = () => {
      load().catch(() => {});
    };
    trigger.addEventListener("mouseenter", ask);
    trigger.addEventListener("focus", ask);
    trigger.addEventListener("touchstart", ask, { passive: true });
  });
}

/**
 * Подключение виджетов: каждый экземпляр на странице — отдельно (Р14).
 */
export function mountStyleAnalysis(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>(".style-analysis[data-style-uid]").forEach((widget) => {
    mountInstance(widget);
  });
}
