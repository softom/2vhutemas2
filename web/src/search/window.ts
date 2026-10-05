/**
 * Окно поиска сайта (Р-109): гибридный поиск — по словам и по смыслу.
 *
 * Открывается кнопкой «Поиск» в шапке, клавишей «/» или Ctrl+K. Модуль
 * грузится по первому нажатию — гость, который не ищет, его не скачивает.
 * Работает и в приложении, и на готовой странице без React, поэтому написан
 * на обычном DOM, как слой замечаний.
 *
 * В выдаче видно, где найдено — в названии, сведениях или тексте, — и
 * фрагмент с совпавшими словами. Когда совпадений по словам нет, окно честно
 * говорит об этом и показывает близкое по смыслу.
 */
import "./window.css";

interface CompactItem {
  component: string;
  asset?: string | null;
  src?: string | null;
  parameter?: string;
  value?: string | null;
}

interface Hit {
  id: number;
  slug: string;
  title_ru: string;
  type: string;
  type_title: string | null;
  status: string;
  found_in: "title" | "params" | "text";
  snippet: string | null;
  matched: ("fulltext" | "vector")[];
  similarity: number | null;
  compact?: CompactItem[];
}

const API = "/api/v1";
const KINDS: [string, string][] = [["", "Всё"], ["title", "Названия"], ["params", "Сведения"], ["text", "Текст"]];
const FOUND: Record<Hit["found_in"], string> = { title: "в названии", params: "в сведениях", text: "в тексте" };
// Совпавшие слова сервер отмечает знаками из частной области Юникода.
const MARK_OPEN = "\uE000";
const MARK_CLOSE = "\uE001";

let dialog: HTMLDialogElement | null = null;
let input: HTMLInputElement;
let list: HTMLElement;
let status: HTMLElement;
let kind = "";
let hits: Hit[] = [];
let active = -1;
let timer = 0;
let controller: AbortController | null = null;

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

/** Фрагмент: текст экранируется, совпавшие слова — <mark>. */
function snippetHtml(snippet: string): string {
  return escapeHtml(snippet.replace(/\n/g, " · "))
    .replaceAll(MARK_OPEN, "<mark>").replaceAll(MARK_CLOSE, "</mark>");
}

/** Токен входа, если человек вошёл: редактор ищет и по черновикам. */
async function authHeader(): Promise<Record<string, string>> {
  try {
    if (!Object.keys(localStorage).some((key) => /^sb-.+-auth-token$/.test(key))) return {};
    const { supabase } = await import("../api");
    const { data } = await supabase.auth.getSession();
    return data.session ? { authorization: `Bearer ${data.session.access_token}` } : {};
  } catch {
    return {};
  }
}

function picture(compact: CompactItem[] | undefined): string {
  const item = compact?.find((c) => c.component === "thumbnail" || c.component === "portrait");
  const src = item?.asset ? `${API}/media/${item.asset}/file?variant=thumbnail` : item?.src ?? null;
  const portrait = item?.component === "portrait" ? " portrait" : "";
  return src
    ? `<img class="search-pic${portrait}" src="${escapeHtml(src)}" alt="" loading="lazy">`
    : `<span class="search-pic empty" aria-hidden="true"></span>`;
}

/**
 * Адрес записи. Найденное в тексте открывается на месте фрагмента: браузер
 * прокручивает к цитате (#:~:text=), разметку страницы для этого менять не нужно.
 */
function href(hit: Hit): string {
  const base = `/entities/${encodeURIComponent(hit.slug)}`;
  if (hit.found_in !== "text" || !hit.snippet) return base;
  const words = hit.snippet.replaceAll(MARK_OPEN, "").replaceAll(MARK_CLOSE, "")
    .split(" … ")[0].trim().split(/\s+/).slice(0, 6).join(" ");
  return words ? `${base}#:~:text=${encodeURIComponent(words)}` : base;
}

function render(query: string) {
  if (query.length < 2) {
    status.textContent = "Ищем по названиям, сведениям и тексту записей — по словам и по смыслу.";
    list.replaceChildren();
    return;
  }
  if (hits.length === 0) {
    status.textContent = "Ничего не нашлось.";
    list.replaceChildren();
    return;
  }
  const exact = hits.some((h) => h.matched.includes("fulltext"));
  status.textContent = exact ? `Найдено: ${hits.length}` : "Совпадений по словам нет — близкое по смыслу:";
  list.innerHTML = hits.map((hit, index) => {
    const bySense = !hit.matched.includes("fulltext");
    const draft = hit.status !== "published" ? '<span class="search-draft">черновик</span>' : "";
    return `<li><a href="${escapeHtml(href(hit))}" data-index="${index}"${index === active ? ' class="active"' : ""}>` +
      picture(hit.compact) +
      `<span class="search-body">` +
      `<span class="search-meta">${escapeHtml(hit.type_title ?? hit.type)} · ${FOUND[hit.found_in]}` +
      `${bySense ? ' · <span class="search-sense">по смыслу</span>' : ""}${draft}</span>` +
      `<span class="search-title">${escapeHtml(hit.title_ru)}</span>` +
      (hit.snippet && hit.found_in !== "title"
        ? `<span class="search-snippet">${snippetHtml(hit.snippet)}</span>` : "") +
      `</span></a></li>`;
  }).join("");
}

async function run() {
  const query = input.value.trim();
  controller?.abort();
  active = -1;
  if (query.length < 2) {
    hits = [];
    render(query);
    return;
  }
  controller = new AbortController();
  status.textContent = "Ищем…";
  try {
    const params = new URLSearchParams({ q: query, limit: "20" });
    if (kind) params.set("kind", kind);
    const response = await fetch(`${API}/search?${params}`, {
      headers: await authHeader(),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(String(response.status));
    hits = (await response.json()).items as Hit[];
    render(query);
  } catch (error) {
    if ((error as Error).name === "AbortError") return;
    hits = [];
    list.replaceChildren();
    status.textContent = "Поиск сейчас недоступен — попробуйте ещё раз.";
  }
}

function move(step: number) {
  if (!hits.length) return;
  active = (active + step + hits.length) % hits.length;
  list.querySelectorAll("a").forEach((a, i) => a.classList.toggle("active", i === active));
  list.querySelectorAll("a")[active]?.scrollIntoView({ block: "nearest" });
}

function build(): HTMLDialogElement {
  const element = document.createElement("dialog");
  element.className = "search-window";
  element.setAttribute("aria-label", "Поиск");
  element.innerHTML =
    `<div class="search-head">` +
    `<input type="search" placeholder="Что найти: название, имя, мысль…" aria-label="Запрос" autocomplete="off">` +
    `<button type="button" class="search-close" aria-label="Закрыть">×</button></div>` +
    `<div class="search-kinds" role="group" aria-label="Где искать">` +
    KINDS.map(([code, label]) =>
      `<button type="button" data-kind="${code}" aria-pressed="${code === kind}">${label}</button>`
    ).join("") +
    `</div><p class="search-status" aria-live="polite"></p><ul class="search-list"></ul>`;
  input = element.querySelector("input")!;
  list = element.querySelector(".search-list")!;
  status = element.querySelector(".search-status")!;

  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(run, 250);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") { event.preventDefault(); move(1); }
    if (event.key === "ArrowUp") { event.preventDefault(); move(-1); }
    if (event.key === "Enter") {
      const target = hits[active >= 0 ? active : 0];
      if (target) location.href = href(target);
    }
  });
  element.querySelector(".search-kinds")!.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-kind]");
    if (!button) return;
    kind = button.dataset.kind ?? "";
    element.querySelectorAll<HTMLButtonElement>("[data-kind]")
      .forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
    run();
    input.focus();
  });
  element.querySelector(".search-close")!.addEventListener("click", () => element.close());
  element.addEventListener("click", (event) => { if (event.target === element) element.close(); });
  document.body.append(element);
  render("");
  return element;
}

export function openSearch() {
  dialog ??= build();
  if (!dialog.open) dialog.showModal();
  input.focus();
  input.select();
}
