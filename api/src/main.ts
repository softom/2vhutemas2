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
    select 'entity_kinds' as dictionary, code, title_ru from app.entity_kinds
    union all select 'object_types', code, title_ru from app.object_types
    union all select 'person_types', code, title_ru from app.person_types
    union all select 'date_kinds', code, title_ru from app.date_kinds
    union all select 'attachment_roles', code, title_ru from app.attachment_roles
    union all select 'reference_kinds', code, title_ru from app.reference_kinds
    union all select 'link_roles', code, title_ru from app.link_roles
    union all select 'media_kinds', code, title_ru from app.media_kinds
    union all select 'object_statuses', code, title_ru from app.object_statuses
    order by 1, 2
  `;
  const grouped: Record<string, { code: string; title_ru: string }[]> = {};
  for (const row of dictionaries) {
    (grouped[row.dictionary] ??= []).push({ code: row.code, title_ru: row.title_ru });
  }
  return c.json({
    contract_version: config.contractVersion,
    blocknote_schema_version: config.blockNoteSchemaVersion,
    limits: {
      page_size_default: config.pagination.defaultPageSize,
      page_size_max: config.pagination.maxPageSize,
      media_max_bytes: config.media.maxBytes,
      media_allowed_mime_types: config.media.allowedMimeTypes,
    },
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

const shutdown = async () => {
  log("info", "system", "остановка сервиса");
  await closePool();
  Deno.exit(0);
};
Deno.addSignalListener("SIGTERM", shutdown);
Deno.addSignalListener("SIGINT", shutdown);

log("info", "system", "запуск сервиса", { port: config.port, db: config.db.host });
Deno.serve({ port: config.port }, app.fetch);
