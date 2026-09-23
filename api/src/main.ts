/**
 * API нового контура 2vhutemas.
 *
 * Единственная точка записи данных: веб-интерфейс, Telegram-бот и навык
 * наполнения проходят через одни и те же проверки прав и правила версий
 * (решение Р-02). Работает от роли app_api, схема app.
 */
import "./lib/json.ts";
import { Hono } from "hono";
import type { Context, Next } from "hono";
import { config } from "./lib/config.ts";
import { closePool, healthCheck, sql } from "./lib/db.ts";
import { principalFromRequest } from "./lib/auth.ts";
import { type AppEnv, cors, handleError, log, requestContext } from "./lib/http.ts";
import { entities } from "./routes/entities.ts";
import { media } from "./routes/media.ts";
import { documents } from "./routes/documents.ts";
import { links } from "./routes/links.ts";
import { places } from "./routes/places.ts";
import { session } from "./routes/session.ts";
import { tags } from "./routes/tags.ts";
import { dates } from "./routes/dates.ts";
import { materials } from "./routes/materials.ts";

const app = new Hono<AppEnv>();

app.use("*", requestContext);
app.use("*", cors);

/** Пользователь определяется по токену; гость допустим — он видит опубликованное. */
app.use("/api/v1/*", async (c: Context<AppEnv>, next: Next) => {
  c.set("principal", await principalFromRequest(c.req.header("authorization")));
  await next();
});

app.onError(handleError);
app.notFound((c) =>
  c.json({
    error: {
      code: "not_found",
      message: "Маршрут не найден",
      details: null,
      request_id: c.get("requestId") ?? "unknown",
    },
  }, 404)
);

app.get("/api/v1/health", async (c: Context<AppEnv>) => {
  const db = await healthCheck();
  return c.json({ status: "ok", db_latency_ms: db.latencyMs, version: config.contractVersion });
});

app.get("/api/v1/capabilities", async (c: Context<AppEnv>) => {
  const dictionaries = await sql`
    select 'date_kinds' as dictionary, code, title_ru from app.date_kinds
    union all select 'attachment_roles', code, title_ru from app.attachment_roles
    union all select 'reference_kinds', code, title_ru from app.reference_kinds
    union all select 'link_roles', code, title_ru from app.link_roles
    union all select 'media_kinds', code, title_ru from app.media_kinds
    union all select 'place_roles', code, title_ru from app.attachment_roles
      where code in ('address', 'birthplace', 'burial', 'office')
    order by 1, 2
  `;
  const grouped: Record<string, { code: string; title_ru: string }[]> = {};
  for (const row of dictionaries) {
    (grouped[row.dictionary] ??= []).push({ code: row.code, title_ru: row.title_ru });
  }

  // Дерево типов отдаётся в порядке обхода сверху вниз: код, название,
  // родитель и глубина. Вид записи — это его корневая ветвь (Р-37).
  const types = await sql`
    with recursive tree as (
        select ty.id, ty.parent_id, ty.code, ty.title_ru, ty.sort_order,
               0 as depth, array[ty.sort_order, 0] as path
          from app.entity_types ty
         where ty.parent_id is null
        union all
        select ch.id, ch.parent_id, ch.code, ch.title_ru, ch.sort_order,
               t.depth + 1, t.path || array[ch.sort_order, 0]
          from app.entity_types ch
          join tree t on ch.parent_id = t.id)
    select t.code, t.title_ru, t.depth,
           (select p.code from app.entity_types p where p.id = t.parent_id) as parent
      from tree t
     order by t.path, t.title_ru
  `;

  return c.json({
    contract_version: config.contractVersion,
    blocknote_schema_version: config.blockNoteSchemaVersion,
    limits: {
      page_size_default: config.pagination.defaultPageSize,
      page_size_max: config.pagination.maxPageSize,
      media_max_bytes: config.media.maxBytes,
      media_allowed_mime_types: config.media.allowedMimeTypes,
    },
    entity_types: types,
    dictionaries: grouped,
  });
});

app.get("/api/v1/me", (c: Context<AppEnv>) => {
  const principal = c.get("principal");
  if (!principal) return c.json({ authenticated: false, permissions: [] });
  return c.json({
    authenticated: true,
    contributor_id: principal.contributorId,
    display_name: principal.displayName,
    status: principal.status,
    permissions: [...principal.permissions].sort(),
  });
});

app.route("/api/v1/entities", entities);
app.route("/api/v1/media", media);
app.route("/api/v1/documents", documents);
app.route("/api/v1/links", links);
app.route("/api/v1/places", places);
app.route("/api/v1/session", session);
app.route("/api/v1/tags", tags);
app.route("/api/v1/entities-dates", dates);
app.route("/api/v1/materials", materials);

const shutdown = async () => {
  log("info", "system", "остановка сервиса");
  await closePool();
  Deno.exit(0);
};
Deno.addSignalListener("SIGTERM", shutdown);
Deno.addSignalListener("SIGINT", shutdown);

log("info", "system", "запуск сервиса", { port: config.port, db: config.db.host });
Deno.serve({ port: config.port }, app.fetch);
