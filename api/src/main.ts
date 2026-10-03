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
import { indicators } from "./routes/indicators.ts";
import { parameters, parameterSets } from "./routes/parameters.ts";
import { newsRobot } from "./routes/newsRobot.ts";
import { materials } from "./routes/materials.ts";
import { pages } from "./routes/pages.ts";
import { CATALOG_HIDDEN_ROOTS } from "./lib/entityTypes.ts";

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
  // Виды дат больше не словарь: дата — такая же величина, и её вид стал
  // параметром (Р-39). Их отдаёт `GET /parameters`.
  // Виды изображения — варианты параметра «Вид изображения» записи
  // «Изображение» (Р-84); под прежним именем словаря их ждёт медиатека.
  const dictionaries = await sql<{dictionary:string;code:string;title_ru:string}>`
    select 'link_roles' as dictionary, code, title_ru from app.link_roles
    union all select 'media_kinds', o.code, o.title_ru
      from app.parameter_options o join app.parameters p on p.id = o.parameter_id
     where p.code = 'image_kind'
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

  // Отображения по типу: для каждого типа и режима — ближайшая настройка
  // вверх по дереву (схема данных, раздел 6). Клиент и готовые страницы
  // собирают вид по этому списку компонентов, а не по своему коду.
  const presentationRows = await sql<{ type: string; mode: string; items: unknown[] }>`
    with recursive up as (
        select t.id as type_id, t.code as type, t.id as ancestor_id, 0 as distance
          from app.entity_types t
        union all
        select up.type_id, up.type, p.parent_id, up.distance + 1
          from up join app.entity_types p on p.id = up.ancestor_id
         where p.parent_id is not null)
    select distinct on (up.type, tp.mode) up.type, tp.mode,
           coalesce((select jsonb_agg(jsonb_build_object(
                        'component', i.component,
                        'parameter', (select code from app.parameters where id = i.parameter_id),
                        'link_role', (select code from app.link_roles where id = i.link_role_id),
                        'settings', i.settings) order by i.sort_order)
                       from app.type_presentation_items i where i.presentation_id = tp.id),
                    '[]'::jsonb) as items
      from up join app.type_presentations tp on tp.type_id = up.ancestor_id
     order by up.type, tp.mode, up.distance
  `;
  const presentations: Record<string, Record<string, unknown[]>> = {};
  for (const row of presentationRows) {
    (presentations[row.type] ??= {})[row.mode] = row.items;
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
    entity_types: types,
    catalog_hidden_roots: CATALOG_HIDDEN_ROOTS,
    dictionaries: grouped,
    presentations,
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
app.route("/api/v1/entities-indicators", indicators);
app.route("/api/v1/parameters", parameters);
app.route("/api/v1/parameter-sets", parameterSets);
app.route("/api/v1/materials", materials);
app.route("/api/v1/news-robot", newsRobot);

// Всё, что не API, — страницы сайта: готовый HTML для поисковиков и ссылок
// (Р-65). Caddy присылает сюда адреса, которым не нашлось файла сборки.
app.route("/", pages);

const shutdown = async () => {
  log("info", "system", "остановка сервиса");
  await closePool();
  Deno.exit(0);
};
Deno.addSignalListener("SIGTERM", shutdown);
Deno.addSignalListener("SIGINT", shutdown);

log("info", "system", "запуск сервиса", { port: config.port, db: config.db.host });
Deno.serve({ port: config.port }, app.fetch);
