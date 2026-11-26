/**
 * «Стилистические решения»: поп-ап полного вида и подгрузка частей.
 *
 * Первичный HTML карточки лёгкий: в нём нет ни вкладок «Близкие объекты»
 * и «Источники», ни подсказок по строкам профиля (Р22). Они приходят по
 * требованию, когда читатель их запросил: поп-ап открывается по кнопке
 * «Исследовать» (Р4, Р6), вкладки — при выборе, подсказка — при наведении
 * или фокусе на строку.
 */
import { loadWidgetPart, openWidgetDialog } from "./widgetModes";

/** Панель полного вида по её признаку. */
function part(html: string, name: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content.querySelector(`[data-style-pane="${name}"]`)?.innerHTML ?? "";
}

export function mountStyleAnalysis(root: ParentNode = document) {
  const widget = root.querySelector<HTMLElement>(".style-analysis[data-style-uid]");
  if (!widget) return;
  const uid = widget.dataset.styleUid ?? "";
  const base = `/api/v1/entities/${uid}/style-analysis`;
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

  // Подсказка строки — по требованию (Р22): свидетельства приходят по связи.
  widget.querySelectorAll<HTMLElement>("[data-style-hint]").forEach((row) => {
    const load = async () => {
      const hintId = row.dataset.styleHintId ?? "";
      if (!hintId || row.dataset.hintLoaded === "true") return;
      const html = await loadWidgetPart(`${base}?part=hint&link=${row.dataset.styleHint ?? ""}`);
      if (!html) return;
      const template = document.createElement("template");
      template.innerHTML = html;
      const tip = template.content.firstElementChild;
      if (!tip) return;
      tip.id = hintId;
      row.append(tip);
      row.setAttribute("aria-describedby", hintId);
      row.dataset.hintLoaded = "true";
    };
    const request = () => {
      load().catch(() => {});
    };
    row.addEventListener("mouseenter", request);
    row.addEventListener("focus", request);
  });
}
