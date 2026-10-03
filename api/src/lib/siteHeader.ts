/** Единый элемент меню для готовых страниц и приложения (Р-75). */
import { can, type Principal } from "./auth.ts";
import { escapeHtml as e, site } from "./site.ts";

export function siteHeader(principal: Principal | null, path = "/"): string {
  const items: [string, string, boolean][] = [
    ["/", "Всё", true], ["/objects", "Проекты", true], ["/authors", "Авторы", true],
    ["/lectures", "Лекции", true], ["/media", "Медиатека", true],
    ["/parameters", "Параметры", can(principal, "edit")],
    ["/robot", "Робот", can(principal, "su")],
    ["/entities/new", "Создать запись", can(principal, "create_delete")],
    ["/about", "О проекте", true],
  ];
  const nav = items.filter(([, , visible]) => visible).map(([href, label]) =>
    `<a href="${href}"${path === href || (href !== "/" && path.startsWith(href + "/")) ? ' class="active"' : ""}>${label}</a>`
  ).join("");
  const viewer = principal
    ? `<span title="${e([...principal.permissions].join(", "))}">${e(principal.displayName)}</span><button type="button" data-action="signout">Выйти</button>`
    : '<a href="/login">Войти</a>';
  // Знак Вх² стоит на красной ленте (Р-56, Р-91): черты и штриховка — из обложки.
  const logo = `<span class="logo-mark"><span class="logo-bar"></span><span class="lg-line l1"></span>` +
    `<span class="lg-hl"></span><span class="lg-hr"></span><span class="lg-line l2"></span><span class="lg-line l3"></span>` +
    `<span class="logo-word">Вх<sup>2</sup></span></span><span class="logo-vert" aria-hidden="true">Два Вхутемас</span>`;
  return `<a class="brand" href="/" aria-label="${e(site.name)} — на главную">${logo}</a><nav>${nav}</nav><div class="viewer">${viewer}</div>`;
}
