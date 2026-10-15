/**
 * Просмотр чертежа DXF на странице записи: масштаб, сдвиг, слои, замеры.
 *
 * Решение пользователя 2026-10-15: чертёж публикуется не ссылкой для
 * скачивания, а пространством для просмотра и простых замеров. Рисует
 * dxf-viewer (WebGL, MPL-2.0); замеры — поверх, в SVG, в координатах самого
 * чертежа. Чертежи бывают вычерчены в масштабе, поэтому есть калибровка по
 * известному размеру; она запоминается в браузере для этого чертежа.
 */
import { DxfViewer } from "dxf-viewer";
import * as three from "three";
import DxfWorker from "./worker?worker";

type Point = { x: number; y: number };
type Shape = { kind: "line" | "area"; points: Point[] };

// Шрифты подгружаются, только когда в чертеже встретился их знак: иероглифы
// (12 МБ) не грузятся на чертежах без них.
const FONTS = ["/fonts/dxf/Roboto.ttf", "/fonts/dxf/NotoSansTC.ttf"].map((p) => new URL(p, location.href).href);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

const fmt = (n: number, digits: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: digits });

export async function mountDrawing(host: HTMLElement) {
  const url = new URL(host.dataset.drawing ?? "", location.href).href;
  host.innerHTML = "";
  host.classList.add("drawing-live");

  const bar = el("div", "drawing-bar");
  const btnLine = el("button", "", "Расстояние");
  const btnArea = el("button", "", "Площадь");
  const btnCal = el("button", "", "Калибровка");
  const btnClear = el("button", "", "Сбросить");
  const btnFit = el("button", "", "Весь чертёж");
  const btnLayers = el("button", "", "Слои");
  const result = el("span", "drawing-result", "");
  for (const b of [btnLine, btnArea, btnCal, btnClear, btnFit, btnLayers]) b.type = "button";
  bar.append(btnLine, btnArea, btnCal, btnClear, btnFit, btnLayers, result);

  const stage = el("div", "drawing-stage");
  const canvasHost = el("div", "drawing-canvas");
  const overlay = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  overlay.setAttribute("class", "drawing-overlay");
  const layersPanel = el("div", "drawing-layers");
  layersPanel.hidden = true;
  const calForm = el("form", "drawing-cal");
  calForm.hidden = true;
  calForm.innerHTML = `<label>Длина отрезка, м <input type="number" step="any" min="0" required></label> <button type="submit">Задать масштаб</button>`;
  const status = el("div", "drawing-status", "Загружаем чертёж…");
  stage.append(canvasHost, overlay, layersPanel, calForm, status);
  host.append(bar, stage);

  const viewer = new DxfViewer(canvasHost, {
    clearColor: new three.Color("#ffffff"),
    autoResize: true,
    colorCorrection: true,
    antialias: true,
  });

  const storeKey = `drawing-scale:${url}`;
  let unitMm = 1;
  try { unitMm = Number(localStorage.getItem(storeKey)) || 1; } catch { /* без хранилища — 1 */ }

  let mode: "line" | "area" | "calibrate" | null = null;
  let draft: Point[] = [];
  let shapes: Shape[] = [];
  let calSegment: Point[] | null = null;

  const toScreen = (p: Point) => {
    const origin = viewer.GetOrigin();
    const camera = viewer.GetCamera();
    // Матрицы камеры обновляются при отрисовке, событие приходит раньше.
    camera.updateMatrixWorld();
    const v = new three.Vector3(p.x - origin.x, p.y - origin.y, 0).project(camera);
    const r = stage.getBoundingClientRect();
    return { x: (v.x + 1) / 2 * r.width, y: (1 - v.y) / 2 * r.height };
  };
  const dist = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
  const lengthText = (units: number) => {
    const mm = units * unitMm;
    return mm >= 1000 ? `${fmt(mm / 1000, 2)} м` : `${fmt(mm, 0)} мм`;
  };
  const areaOf = (pts: Point[]) => {
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      s += a.x * b.y - b.x * a.y;
    }
    return Math.abs(s) / 2;
  };
  const areaText = (units2: number) => `${fmt(units2 * unitMm * unitMm / 1e6, 2)} м²`;

  function draw() {
    const parts: string[] = [];
    const poly = (pts: Point[], closed: boolean, color: string) => {
      const s = pts.map(toScreen);
      parts.push(`<${closed ? "polygon" : "polyline"} points="${s.map((p) => `${p.x},${p.y}`).join(" ")}" fill="${closed ? color + "22" : "none"}" stroke="${color}" stroke-width="2"/>`);
      for (const p of s) parts.push(`<circle cx="${p.x}" cy="${p.y}" r="3.5" fill="${color}"/>`);
      return s;
    };
    const label = (x: number, y: number, text: string, color: string) =>
      parts.push(`<text x="${x}" y="${y}" fill="${color}" font-size="13" font-weight="600" paint-order="stroke" stroke="#fff" stroke-width="4">${text}</text>`);
    for (const shape of shapes) {
      if (shape.kind === "line") {
        const s = poly(shape.points, false, "#b23a1e");
        label((s[0].x + s[1].x) / 2 + 6, (s[0].y + s[1].y) / 2 - 6, lengthText(dist(shape.points[0], shape.points[1])), "#b23a1e");
      } else {
        const s = poly(shape.points, true, "#1e6fb2");
        const cx = s.reduce((a, p) => a + p.x, 0) / s.length, cy = s.reduce((a, p) => a + p.y, 0) / s.length;
        label(cx, cy, areaText(areaOf(shape.points)), "#1e6fb2");
      }
    }
    if (draft.length) poly(draft, false, mode === "calibrate" ? "#2b8a3e" : mode === "area" ? "#1e6fb2" : "#b23a1e");
    overlay.innerHTML = parts.join("");
  }

  function setMode(next: typeof mode) {
    mode = mode === next ? null : next;
    draft = [];
    calForm.hidden = true;
    btnLine.classList.toggle("on", mode === "line");
    btnArea.classList.toggle("on", mode === "area");
    btnCal.classList.toggle("on", mode === "calibrate");
    result.textContent = mode === "line" ? "Щелчок в начале и в конце отрезка"
      : mode === "area" ? "Щелчки по углам контура; двойной щелчок — замкнуть"
      : mode === "calibrate" ? "Щелчок по концам известного размера" : "";
    draw();
  }

  // Точка — щелчок без перетаскивания: сдвиг чертежа точкой не считается.
  let downAt: Point | null = null;
  viewer.Subscribe("pointerdown", (e: { detail: { domEvent: PointerEvent } }) => {
    downAt = { x: e.detail.domEvent.clientX, y: e.detail.domEvent.clientY };
  });
  viewer.Subscribe("pointerup", (e: { detail: { domEvent: PointerEvent; position: Point } }) => {
    const dom = e.detail.domEvent;
    if (!mode || dom.button !== 0) return;
    if (downAt && Math.hypot(dom.clientX - downAt.x, dom.clientY - downAt.y) > 4) return;
    const origin = viewer.GetOrigin();
    const p = { x: e.detail.position.x + origin.x, y: e.detail.position.y + origin.y };
    draft.push(p);
    if ((mode === "line" || mode === "calibrate") && draft.length === 2) {
      if (mode === "line") {
        shapes.push({ kind: "line", points: draft });
        result.textContent = lengthText(dist(draft[0], draft[1]));
        draft = [];
      } else {
        calSegment = draft;
        draft = [];
        calForm.hidden = false;
        calForm.querySelector("input")!.focus();
      }
    }
    draw();
  });
  canvasHost.addEventListener("dblclick", () => {
    if (mode !== "area") return;
    // Двойной щелчок даёт и две точки-щелчка: последняя лишняя.
    const pts = draft.slice(0, -1);
    if (pts.length >= 3) {
      shapes.push({ kind: "area", points: pts });
      result.textContent = areaText(areaOf(pts));
    }
    draft = [];
    draw();
  });
  calForm.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const real = Number(calForm.querySelector("input")!.value.replace(",", "."));
    if (calSegment && real > 0) {
      const units = dist(calSegment[0], calSegment[1]);
      if (units > 0) {
        unitMm = real * 1000 / units;
        try { localStorage.setItem(storeKey, String(unitMm)); } catch { /* только на эту загрузку */ }
        result.textContent = `Масштаб задан: замеры в натуральную величину`;
      }
    }
    calSegment = null;
    setMode(null);
  });
  viewer.Subscribe("viewChanged", () => requestAnimationFrame(draw));
  viewer.Subscribe("resized", () => requestAnimationFrame(draw));

  btnLine.onclick = () => setMode("line");
  btnArea.onclick = () => setMode("area");
  btnCal.onclick = () => setMode("calibrate");
  btnClear.onclick = () => { shapes = []; draft = []; result.textContent = ""; draw(); };
  btnFit.onclick = () => {
    const b = viewer.GetBounds(), o = viewer.GetOrigin();
    if (b) viewer.FitView(b.minX - o.x, b.maxX - o.x, b.minY - o.y, b.maxY - o.y);
  };
  btnLayers.onclick = () => { layersPanel.hidden = !layersPanel.hidden; };

  // Чертёж и шрифт — десятки мегабайт: при обрыве соединения пробуем ещё.
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await viewer.Load({ url, fonts: FONTS, workerFactory: () => new DxfWorker() });
      lastError = null;
      break;
    } catch (err) {
      lastError = err;
      status.textContent = `Повторяем загрузку (${attempt + 1} из 3)…`;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  if (lastError) {
    status.innerHTML = "";
    status.append(`Чертёж не открылся: ${(lastError as Error)?.message ?? lastError}. `);
    const link = el("a", "", "Скачать DXF");
    (link as HTMLAnchorElement).href = url;
    status.append(link);
    return;
  }
  status.remove();
  for (const layer of viewer.GetLayers(true)) {
    const label = el("label");
    const box = el("input");
    box.type = "checkbox";
    box.checked = true;
    box.onchange = () => viewer.ShowLayer(layer.name, box.checked);
    const swatch = el("span", "drawing-swatch");
    swatch.style.background = `#${layer.color.toString(16).padStart(6, "0")}`;
    label.append(box, swatch, document.createTextNode(` ${layer.displayName}`));
    layersPanel.append(label);
  }
}

// Чертежи открываются по одному: два файла по 8 МБ и шрифт на 12 МБ разом
// на неустойчивой связи обрывались («Failed to fetch»).
let queue: Promise<void> = Promise.resolve();
const enqueue = (host: HTMLElement) => {
  queue = queue.then(() => mountDrawing(host)).catch(() => {});
};

/** Все чертежи страницы — по мере появления на экране, по одному. */
export function mountDrawings(root: ParentNode = document) {
  const hosts = [...root.querySelectorAll<HTMLElement>("[data-drawing]:not(.drawing-live)")];
  if (hosts.length === 0) return;
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      enqueue(entry.target as HTMLElement);
    }
  }, { rootMargin: "200px" });
  for (const host of hosts) observer.observe(host);
}
