/**
 * Слой замечаний поверх страницы сайта (Р-95): комментарий-булавка со своей
 * веткой, стикер, текст, карандаш, рамка, стрелка — как на холсте макета,
 * только поверх живой страницы и настоящих данных.
 *
 * Модуль грузится по нажатию «Замечания» (его видят правящие): гость не
 * скачивает ни этот код, ни стили, ни пометки. Работает и в приложении, и на
 * готовой странице записи без React — поэтому написан на обычном DOM.
 *
 * Привязка: пометка цепляется к элементу страницы под ней (абзац, снимок,
 * плитка) и хранит точку в долях его рамки — вёрстка резиновая, и пиксели при
 * другой ширине окна уехали бы. Запасной ход — точка документа.
 */
import "./layer.css";
import { api, type NoteAnchor, type PageNote } from "../api";

type Tool = "view" | "comment" | "sticky" | "text" | "pen" | "rect" | "arrow";

const COLORS: Record<string, string> = {
  red: "#A9381F", ink: "#231F1C", orange: "#C9691E", blue: "#2F5D9E", green: "#3C7A4B",
};
const TOOLS: [Tool, string, string][] = [
  ["view", "Просмотр", '<path d="M5 3l14 8-6 2-2 6z"/>'],
  ["comment", "Комментарий", '<path d="M4 5h16v11H9l-5 4z"/>'],
  ["sticky", "Стикер", '<path d="M4 4h16v10l-6 6H4z"/><path d="M14 20v-6h6"/>'],
  ["text", "Текст", '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>'],
  ["pen", "Карандаш", '<path d="m16 3 5 5-12 12-6 1 1-6Z"/>'],
  ["rect", "Рамка", '<rect x="4" y="6" width="16" height="12"/>'],
  ["arrow", "Стрелка", '<path d="M5 19 19 5M10 5h9v9"/>'],
];
// Привязка ищет осмысленный элемент, а не случайный span внутри строки.
const ANCHORS = "p,li,figure,img,h1,h2,h3,h4,blockquote,dl,dd,dt,table,tr,.card,a,button,input,select," +
  "header,nav,footer,section,article,aside,main";
const SVG = "http://www.w3.org/2000/svg";

let root: HTMLElement | null = null;
let layer: HTMLElement | null = null;
let svg: SVGSVGElement | null = null;
let capture: HTMLElement | null = null;
let popover: HTMLElement | null = null;
let notes: PageNote[] = [];
let tool: Tool = "view";
let color = "red";
let showResolved = false;
let path = "";
let timer = 0;
let observer: ResizeObserver | null = null;

export function toggleNotes() {
  if (root) close(); else void open();
}

async function open() {
  path = location.pathname;
  root = document.createElement("div");
  root.className = "notes-root";
  layer = el("div", "notes-layer");
  svg = document.createElementNS(SVG, "svg");
  svg.classList.add("notes-svg");
  svg.innerHTML = '<defs><marker id="notes-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="context-stroke"/></marker></defs>';
  layer.append(svg);
  capture = el("div", "notes-capture");
  capture.hidden = true;
  root.append(layer, capture, toolbar());
  document.body.append(root);
  pressed(true);
  capture.addEventListener("pointerdown", startDraw);
  document.addEventListener("keydown", onKey);
  globalThis.addEventListener("resize", schedule);
  observer = new ResizeObserver(schedule);
  observer.observe(document.body);
  // Приложение меняет адрес без перезагрузки: слой следует за страницей.
  timer = globalThis.setInterval(() => {
    if (location.pathname !== path) { path = location.pathname; closePopover(); void load(); }
  }, 600);
  await load();
}

function close() {
  closePopover();
  observer?.disconnect();
  globalThis.clearInterval(timer);
  globalThis.removeEventListener("resize", schedule);
  document.removeEventListener("keydown", onKey);
  root?.remove();
  root = layer = capture = null;
  svg = null;
  pressed(false);
}

function pressed(on: boolean) {
  document.querySelectorAll<HTMLElement>('[data-action="notes"]').forEach((b) => b.setAttribute("aria-pressed", String(on)));
}

async function load() {
  try {
    notes = (await api.pageNotes(path, showResolved)).items;
    render();
  } catch (error) {
    toast(error instanceof Error ? error.message : "Не удалось загрузить замечания");
  }
}

// ── Панель ───────────────────────────────────────────────────────────────────

function toolbar(): HTMLElement {
  const bar = el("div", "notes-bar");
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Замечания к странице");
  for (const [code, label, icon] of TOOLS) {
    const button = el("button", "notes-tool") as HTMLButtonElement;
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.dataset.tool = code;
    button.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg>`;
    button.addEventListener("click", () => setTool(code));
    bar.append(button);
  }
  bar.append(el("span", "notes-sep"));
  for (const [code, value] of Object.entries(COLORS)) {
    const swatch = el("button", "notes-color") as HTMLButtonElement;
    swatch.type = "button";
    swatch.style.background = value;
    swatch.dataset.color = code;
    swatch.setAttribute("aria-label", `Цвет: ${code}`);
    swatch.addEventListener("click", () => { color = code; syncBar(); });
    bar.append(swatch);
  }
  bar.append(el("span", "notes-sep"));
  const resolved = el("button", "notes-text-btn") as HTMLButtonElement;
  resolved.type = "button";
  resolved.dataset.role = "resolved";
  resolved.addEventListener("click", () => { showResolved = !showResolved; syncBar(); void load(); });
  const count = el("span", "notes-count");
  count.dataset.role = "count";
  const exit = el("button", "notes-text-btn") as HTMLButtonElement;
  exit.type = "button";
  exit.textContent = "Закрыть";
  exit.addEventListener("click", close);
  bar.append(resolved, count, exit);
  queueMicrotask(syncBar);
  return bar;
}

function syncBar() {
  if (!root) return;
  root.querySelectorAll<HTMLElement>(".notes-tool").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tool === tool)));
  root.querySelectorAll<HTMLElement>(".notes-color").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.color === color)));
  const resolved = root.querySelector<HTMLElement>('[data-role="resolved"]');
  if (resolved) resolved.textContent = showResolved ? "Скрыть решённые" : "Показать решённые";
  const count = root.querySelector<HTMLElement>('[data-role="count"]');
  if (count) {
    const open = notes.filter((n) => n.status === "open").length;
    count.textContent = `открыто: ${open}`;
  }
}

function setTool(next: Tool) {
  tool = next;
  closePopover();
  if (capture) {
    capture.hidden = tool === "view";
    capture.dataset.tool = tool;
  }
  syncBar();
}

function onKey(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  if (popover) closePopover(); else setTool("view");
}

// ── Привязка ─────────────────────────────────────────────────────────────────

/** Элемент страницы под точкой — без самого слоя. */
function targetAt(clientX: number, clientY: number): Element | null {
  for (const found of document.elementsFromPoint(clientX, clientY)) {
    if (root?.contains(found)) continue;
    return found.closest(ANCHORS) ?? found;
  }
  return null;
}

/** Путь до элемента от body: тег и номер среди своих — переживает перерисовку. */
function cssPath(node: Element): string {
  const parts: string[] = [];
  let current: Element | null = node;
  while (current && current !== document.body && current.parentElement) {
    const tag = current.tagName.toLowerCase();
    const siblings = [...current.parentElement.children].filter((c) => c.tagName === current!.tagName);
    parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(current) + 1})` : tag);
    current = current.parentElement;
  }
  return ["body", ...parts].join(" > ");
}

interface Frame { left: number; top: number; width: number; height: number }

function frameOf(node: Element): Frame {
  const rect = node.getBoundingClientRect();
  return { left: rect.left + scrollX, top: rect.top + scrollY, width: Math.max(rect.width, 1), height: Math.max(rect.height, 1) };
}

function anchorAt(clientX: number, clientY: number): { anchor: NoteAnchor; frame: Frame } {
  const pageX = clientX + scrollX;
  const pageY = clientY + scrollY;
  const node = targetAt(clientX, clientY);
  if (!node || node === document.body || node === document.documentElement) {
    return { anchor: { pageX, pageY }, frame: { left: 0, top: 0, width: 1, height: 1 } };
  }
  const frame = frameOf(node);
  return {
    anchor: { selector: cssPath(node), x: (pageX - frame.left) / frame.width, y: (pageY - frame.top) / frame.height, pageX, pageY },
    frame,
  };
}

/** Рамка привязки сейчас: элемент найден — его рамка, иначе — точка документа. */
function resolveFrame(anchor: NoteAnchor): { frame: Frame; x: number; y: number; lost: boolean } {
  let node: Element | null = null;
  try { node = anchor.selector ? document.querySelector(anchor.selector) : null; } catch { node = null; }
  if (node && anchor.x !== undefined && anchor.y !== undefined) {
    const frame = frameOf(node);
    return { frame, x: frame.left + anchor.x * frame.width, y: frame.top + anchor.y * frame.height, lost: false };
  }
  return { frame: { left: 0, top: 0, width: 1, height: 1 }, x: anchor.pageX ?? 0, y: anchor.pageY ?? 0, lost: !!anchor.selector };
}

const toFrame = (frame: Frame, x: number, y: number): [number, number] =>
  [(x - frame.left) / frame.width, (y - frame.top) / frame.height];
const fromFrame = (frame: Frame, [x, y]: [number, number]): [number, number] =>
  [frame.left + x * frame.width, frame.top + y * frame.height];

// ── Рисование ────────────────────────────────────────────────────────────────

function startDraw(event: PointerEvent) {
  if (!capture || event.button !== 0) return;
  event.preventDefault();
  const { anchor, frame } = anchorAt(event.clientX, event.clientY);
  if (tool === "comment" || tool === "sticky" || tool === "text") {
    compose(tool, anchor, event.clientX, event.clientY);
    return;
  }
  // Рамке привязки нужна ненулевая величина: без элемента — доли пикселя документа.
  const start: [number, number] = [event.clientX + scrollX, event.clientY + scrollY];
  const points: [number, number][] = [start];
  const preview = document.createElementNS(SVG, tool === "pen" ? "polyline" : tool === "rect" ? "rect" : "line");
  shapeStyle(preview, color, tool);
  svg?.append(preview);
  capture.setPointerCapture(event.pointerId);

  const move = (e: PointerEvent) => {
    const point: [number, number] = [e.clientX + scrollX, e.clientY + scrollY];
    if (tool === "pen") {
      const last = points[points.length - 1];
      if (Math.hypot(point[0] - last[0], point[1] - last[1]) < 3) return;
      points.push(point);
    } else {
      points[1] = point;
    }
    drawShape(preview, tool, points);
  };
  const up = async () => {
    capture?.removeEventListener("pointermove", move);
    capture?.removeEventListener("pointerup", up);
    preview.remove();
    if (points.length < 2) return;
    const end = points[points.length - 1];
    if (Math.hypot(end[0] - start[0], end[1] - start[1]) < 6 && tool !== "pen") return;
    const geometry = tool === "pen"
      ? { points: points.map(([x, y]) => toFrame(frame, x, y)) }
      : (() => { const [x2, y2] = toFrame(frame, end[0], end[1]); return { x2, y2 }; })();
    await save({ kind: tool as PageNote["kind"], anchor, geometry, body: "" });
  };
  capture.addEventListener("pointermove", move);
  capture.addEventListener("pointerup", up);
}

function shapeStyle(shape: SVGElement, colorCode: string, kind: string) {
  shape.setAttribute("fill", "none");
  shape.setAttribute("stroke", COLORS[colorCode] ?? COLORS.red);
  shape.setAttribute("stroke-width", kind === "pen" ? "2.5" : "2");
  shape.setAttribute("stroke-linecap", "round");
  shape.setAttribute("stroke-linejoin", "round");
  if (kind === "arrow") shape.setAttribute("marker-end", "url(#notes-arrow)");
}

function drawShape(shape: SVGElement, kind: string, points: [number, number][]) {
  if (kind === "pen") {
    shape.setAttribute("points", points.map((p) => p.join(",")).join(" "));
  } else if (kind === "rect" && points[1]) {
    const [[x1, y1], [x2, y2]] = points;
    shape.setAttribute("x", String(Math.min(x1, x2)));
    shape.setAttribute("y", String(Math.min(y1, y2)));
    shape.setAttribute("width", String(Math.abs(x2 - x1)));
    shape.setAttribute("height", String(Math.abs(y2 - y1)));
  } else if (points[1]) {
    const [[x1, y1], [x2, y2]] = points;
    shape.setAttribute("x1", String(x1)); shape.setAttribute("y1", String(y1));
    shape.setAttribute("x2", String(x2)); shape.setAttribute("y2", String(y2));
  }
}

// ── Показ ────────────────────────────────────────────────────────────────────

function schedule() {
  if (!root) return;
  cancelAnimationFrame(Number(root.dataset.frame ?? 0));
  root.dataset.frame = String(requestAnimationFrame(render));
}

function render() {
  if (!layer || !svg) return;
  const width = document.documentElement.scrollWidth;
  const height = document.documentElement.scrollHeight;
  layer.style.width = `${width}px`;
  layer.style.height = `${height}px`;
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  layer.querySelectorAll(".notes-item").forEach((node) => node.remove());
  svg.querySelectorAll(".notes-shape").forEach((node) => node.remove());

  let number = 0;
  for (const note of notes) {
    const where = resolveFrame(note.anchor ?? {});
    const done = note.status === "resolved";
    if (note.kind === "pen" || note.kind === "rect" || note.kind === "arrow") {
      const shape = document.createElementNS(SVG, note.kind === "pen" ? "polyline" : note.kind === "rect" ? "rect" : "line");
      shape.classList.add("notes-shape");
      if (done) shape.classList.add("is-resolved");
      shapeStyle(shape, note.color, note.kind);
      const points: [number, number][] = note.kind === "pen"
        ? (note.geometry.points ?? []).map((p) => fromFrame(where.frame, p))
        : [[where.x, where.y], fromFrame(where.frame, [note.geometry.x2 ?? 0, note.geometry.y2 ?? 0])];
      drawShape(shape, note.kind, points);
      shape.addEventListener("click", (e) => { e.stopPropagation(); thread(note, (e as MouseEvent).clientX, (e as MouseEvent).clientY); });
      svg.append(shape);
      continue;
    }
    const item = el("button", `notes-item notes-${note.kind}`) as HTMLButtonElement;
    item.type = "button";
    if (done) item.classList.add("is-resolved");
    if (where.lost) item.classList.add("is-lost");
    item.style.left = `${where.x}px`;
    item.style.top = `${where.y}px`;
    item.style.setProperty("--note", COLORS[note.color] ?? COLORS.red);
    if (note.kind === "comment") {
      number += 1;
      item.textContent = String(number);
      item.setAttribute("aria-label", `Замечание ${number}: ${note.body}`);
    } else {
      item.textContent = note.body;
    }
    const replies = note.replies?.length ?? 0;
    if (replies > 0 && note.kind !== "comment") item.dataset.replies = String(replies);
    item.addEventListener("click", (e) => { e.stopPropagation(); thread(note, e.clientX, e.clientY); });
    layer.append(item);
  }
  syncBar();
}

// ── Окна ─────────────────────────────────────────────────────────────────────

function closePopover() {
  popover?.remove();
  popover = null;
}

function place(box: HTMLElement, clientX: number, clientY: number) {
  root?.append(box);
  const width = box.offsetWidth;
  const height = box.offsetHeight;
  box.style.left = `${Math.max(8, Math.min(clientX + 12, innerWidth - width - 8))}px`;
  box.style.top = `${Math.max(8, Math.min(clientY + 12, innerHeight - height - 72))}px`;
  popover = box;
}

/** Новая пометка с текстом: комментарий, стикер или надпись. */
function compose(kind: Tool, anchor: NoteAnchor, clientX: number, clientY: number) {
  closePopover();
  const box = el("form", "notes-pop");
  const title = el("div", "notes-pop-head");
  title.textContent = kind === "comment" ? "Замечание" : kind === "sticky" ? "Стикер" : "Надпись";
  const field = el("textarea", "notes-input") as HTMLTextAreaElement;
  field.rows = kind === "text" ? 2 : 4;
  field.placeholder = kind === "comment" ? "Что поправить здесь" : "Текст";
  field.setAttribute("aria-label", title.textContent);
  const actions = el("div", "notes-actions");
  const ok = button("Сохранить", "submit");
  const cancel = button("Отмена");
  cancel.addEventListener("click", closePopover);
  actions.append(ok, cancel);
  box.append(title, field, actions);
  box.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!field.value.trim()) return;
    ok.disabled = true;
    await save({ kind: kind as PageNote["kind"], anchor, geometry: {}, body: field.value.trim() });
    closePopover();
  });
  place(box, clientX, clientY);
  field.focus();
}

/** Ветка пометки: текст, ответы, «решено», удаление. */
function thread(note: PageNote, clientX: number, clientY: number) {
  closePopover();
  const box = el("div", "notes-pop");
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", "Ветка замечания");
  const head = el("div", "notes-pop-head");
  head.textContent = `${note.author ?? "—"} · ${date(note.created_at)}`;
  box.append(head);
  if (note.body) box.append(para(note.body));
  if (note.viewport_width && Math.abs(note.viewport_width - innerWidth) > 80) {
    box.append(para(`Поставлено при ширине окна ${note.viewport_width} px — сейчас ${innerWidth} px.`, "notes-hint"));
  }
  if (resolveFrame(note.anchor ?? {}).lost) {
    box.append(para("Элемент, к которому была привязка, на странице не найден: показано по прежней точке.", "notes-hint"));
  }
  for (const reply of note.replies ?? []) {
    const line = el("div", "notes-reply");
    const who = el("div", "notes-pop-head");
    who.textContent = `${reply.author ?? "—"} · ${date(reply.created_at)}`;
    line.append(who, para(reply.body));
    box.append(line);
  }
  const form = el("form", "notes-answer");
  const field = el("textarea", "notes-input") as HTMLTextAreaElement;
  field.rows = 2;
  field.placeholder = "Ответить";
  field.setAttribute("aria-label", "Ответ в ветке");
  const send = button("Ответить", "submit");
  form.append(field, send);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!field.value.trim()) return;
    send.disabled = true;
    await save({ kind: "reply", parent_id: note.id, body: field.value.trim() });
    const fresh = notes.find((n) => n.id === note.id);
    if (fresh) thread(fresh, clientX, clientY); else closePopover();
  });
  const actions = el("div", "notes-actions");
  const status = button(note.status === "open" ? "Решено" : "Открыть снова");
  status.addEventListener("click", async () => {
    await act(() => api.updatePageNote(note.id, { status: note.status === "open" ? "resolved" : "open" }));
    closePopover();
  });
  const remove = button("Удалить");
  remove.classList.add("is-quiet");
  remove.addEventListener("click", async () => {
    if (!confirm("Удалить пометку вместе с ответами?")) return;
    await act(() => api.deletePageNote(note.id));
    closePopover();
  });
  const shut = button("Закрыть");
  shut.addEventListener("click", closePopover);
  actions.append(status, remove, shut);
  box.append(form, actions);
  place(box, clientX, clientY);
}

// ── Запись ───────────────────────────────────────────────────────────────────

async function save(note: Partial<PageNote> & { parent_id?: string }) {
  await act(() => api.createPageNote({
    ...note,
    page_path: path,
    color,
    viewport_width: innerWidth,
  }));
}

async function act(action: () => Promise<unknown>) {
  try {
    await action();
    await load();
  } catch (error) {
    toast(error instanceof Error ? error.message : "Не получилось");
  }
}

// ── Мелочи ───────────────────────────────────────────────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function button(label: string, type: "button" | "submit" = "button"): HTMLButtonElement {
  const node = el("button", "notes-btn");
  node.type = type;
  node.textContent = label;
  return node;
}

function para(text: string, className = "notes-body"): HTMLElement {
  const node = el("p", className);
  node.textContent = text;
  return node;
}

function date(value: string): string {
  return new Date(value).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function toast(message: string) {
  const node = el("div", "notes-toast");
  node.setAttribute("role", "status");
  node.textContent = message;
  (root ?? document.body).append(node);
  setTimeout(() => node.remove(), 4000);
}
