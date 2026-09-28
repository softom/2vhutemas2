/** Единый элемент меню для готовых страниц и приложения (Р-75). */
import { can, type Principal } from "./auth.ts";
import { escapeHtml as e, site } from "./site.ts";

export function siteHeader(principal: Principal | null, path = "/"): string {
  const items: [string, string, boolean][] = [
    ["/", "Всё", true], ["/objects", "Проекты", true], ["/authors", "Авторы", true],
    ["/lectures", "Лекции", true], ["/media", "Медиатека", true],
    ["/parameters", "Параметры", can(principal, "edit")],
    ["/entities/new", "Создать запись", can(principal, "create_delete")],
    ["/about", "О проекте", true],
  ];
  const nav = items.filter(([, , visible]) => visible).map(([href, label]) =>
    `<a href="${href}"${path === href || (href !== "/" && path.startsWith(href + "/")) ? ' class="active"' : ""}>${label}</a>`
  ).join("");
  const viewer = principal
    ? `<span title="${e([...principal.permissions].join(", "))}">${e(principal.displayName)}</span><button type="button" data-action="signout">Выйти</button>`
    : '<a href="/login">Войти</a>';
  return `<a class="brand" href="/">${e(site.name)}</a><nav>${nav}</nav><div class="viewer">${viewer}</div>`;
}
