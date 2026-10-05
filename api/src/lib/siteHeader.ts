/** Единый элемент меню для готовых страниц и приложения (Р-75). */
import { can, type Principal } from "./auth.ts";
import { escapeHtml as e, site } from "./site.ts";

export function siteHeader(principal: Principal | null, path = "/"): string {
  const items: [string, string, boolean][] = [
    ["/", "Новости", true], ["/objects", "Проекты", true], ["/authors", "Авторы", true],
    ["/lectures", "Лекции", true], ["/media", "Медиатека", true],
    ["/parameters", "Параметры", can(principal, "edit")],
    ["/robot", "Робот", can(principal, "su")],
    ["/entities/new", "Создать запись", can(principal, "create_delete")],
    ["/about", "О проекте", true],
  ];
  // Подменю пункта: раздел «Робот» (Р-96) — разделы страницы робота, только su.
  const submenus: Record<string, [string, string][]> = {
    "/robot": [["/robot/news", "Новости"], ["/robot/stack", "Стек"], ["/robot/sites", "Сайты"],
      ["/robot/recs", "Рекомендации"], ["/robot/log", "Журнал"]],
  };
  const nav = items.filter(([, , visible]) => visible).map(([href, label]) => {
    // «Новости» — главная и её архив /news.
    const active = path === href || (href !== "/" && path.startsWith(href + "/")) ||
      (href === "/" && (path === "/news" || path.startsWith("/news/")));
    const link = `<a href="${href}"${active ? ' class="active"' : ""}>${label}</a>`;
    const sub = submenus[href];
    return sub
      ? `<span class="nav-group">${link}<span class="nav-sub">${sub.map(([h, l]) => `<a href="${h}">${l}</a>`).join("")}</span></span>`
      : link;
  }).join("");
  // Замечания поверх страницы (Р-95) — только тем, кто правит: слой и его код
  // грузятся по нажатию, гостю страница не тяжелеет.
  const notes = can(principal, "edit")
    ? `<button type="button" class="notes-toggle" data-action="notes" aria-pressed="false">Замечания</button>`
    : "";
  // Поиск (Р-109) — всем; окно и его код грузятся по нажатию, «/» и Ctrl+K.
  const search = `<button type="button" class="search-toggle" data-action="search" title="Поиск ( / )" aria-label="Поиск">` +
    `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>Поиск</button>`;
  const viewer = search + (principal
    ? notes + `<span title="${e([...principal.permissions].join(", "))}">${e(principal.displayName)}</span><button type="button" data-action="signout">Выйти</button>`
    : '<a href="/login">Войти</a>');
  // Знак Вх² стоит на красной ленте (Р-56, Р-91): черты и штриховка — из обложки.
  const logo = `<span class="logo-mark"><span class="logo-bar"></span><span class="lg-line l1"></span>` +
    `<span class="lg-hl"></span><span class="lg-hr"></span><span class="lg-line l2"></span><span class="lg-line l3"></span>` +
    `<span class="logo-word">Вх<sup>2</sup></span></span><span class="logo-vert" aria-hidden="true">Два Вхутемас</span>`;
  return `<a class="brand" href="/" aria-label="${e(site.name)} — на главную">${logo}</a><nav>${nav}</nav><div class="viewer">${viewer}</div>`;
}

/**
 * Футер — один на готовые страницы и приложение, как и меню: приложение берёт
 * его из того же ответа `/api/v1/site-header`. Формула знака, «=» стоит на
 * красной ленте (Р-91).
 */
export function siteFooter(): string {
  return `<div class="foot-axis"><span>Искусство</span><span class="eq">=</span><span>Вх<sup>2</sup>·м</span></div>` +
    `<div class="foot-line"><span>2vhutemas · курс квантовой архитектуры</span><span>Прежний сайт — <a href="/old/">2vhutemas.ru/old</a></span></div>`;
}
