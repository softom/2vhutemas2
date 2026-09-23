/**
 * Сессионная кука для показа файлов.
 *
 * Изображение в теге <img> нельзя сопроводить заголовком с токеном, поэтому
 * приватные файлы в редакторе и карточках иначе не показать. Клиент меняет
 * свой токен на короткоживущую куку, которую браузер прикладывает сам.
 *
 * Кука подписана секретом сервера, действует час, недоступна сценариям
 * страницы и отправляется только на собственные адреса медиа.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { config } from "../lib/config.ts";
import { require as requirePermission } from "../lib/auth.ts";
import type { AppEnv } from "../lib/http.ts";

export const session = new Hono<AppEnv>();

const COOKIE = "media_session";
const TTL_SECONDS = 3600;

async function sign(value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(config.auth.jwtSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Проверка куки: возвращает идентификатор участника либо пусто. */
export async function contributorFromCookie(header: string | undefined): Promise<string | null> {
  if (!header) return null;
  const raw = header.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!raw) return null;

  const [contributorId, expires, signature] = decodeURIComponent(raw).split(".");
  if (!contributorId || !expires || !signature) return null;
  if (Number(expires) * 1000 < Date.now()) return null;
  if (await sign(`${contributorId}.${expires}`) !== signature) return null;
  return contributorId;
}

session.post("/", async (c: Context<AppEnv>) => {
  const principal = requirePermission(c.get("principal"), "view");
  const expires = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const payload = `${principal.contributorId}.${expires}`;
  const value = `${payload}.${await sign(payload)}`;

  c.header(
    "set-cookie",
    `${COOKIE}=${encodeURIComponent(value)}; Max-Age=${TTL_SECONDS}; Path=/api/v1/media; ` +
      `HttpOnly; SameSite=Strict; Secure`,
  );
  return c.json({ expires_at: new Date(expires * 1000).toISOString() });
});

session.delete("/", (c: Context<AppEnv>) => {
  c.header("set-cookie", `${COOKIE}=; Max-Age=0; Path=/api/v1/media; HttpOnly; SameSite=Strict; Secure`);
  return c.body(null, 204);
});
