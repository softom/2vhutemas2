/**
 * Поиск (Р-109): гибридный — по словам и по смыслу.
 *
 * GET /search?q=…               выдача: запись, где найдено, фрагмент
 *   &kind=title,params,text     искать только в названиях / сведениях / тексте
 *   &type=<код ветви>           только в ветви дерева
 *   &limit=20
 * GET /search/status            состояние индекса (право edit)
 * POST /search/reindex          пересобрать куски всех записей (su)
 *
 * Гость ищет по опубликованным версиям, редактор — по рабочим. Совпавшие
 * слова во фрагменте — между знаками U+E000 и U+E001: клиент сам решает,
 * как их выделить, и сам экранирует текст.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { sql } from "../lib/db.ts";
import { ApiError } from "../lib/errors.ts";
import { canSeeDrafts, require as requirePermission } from "../lib/auth.ts";
import type { AppEnv } from "../lib/http.ts";
import { config } from "../lib/config.ts";
import { embeddingsEnabled, embedQuery, rebuildAll, stats } from "../lib/search.ts";

export const search = new Hono<AppEnv>();

const KINDS = new Set(["title", "params", "text"]);

/** В выдачу по умолчанию не идут файлы: их находят через записи, к которым они относятся. */
const SEARCH_HIDDEN_ROOTS = ["materials"];

search.get("/", async (c: Context<AppEnv>) => {
  const query = (c.req.query("q") ?? "").trim();
  if (query.length < 2) {
    throw new ApiError("validation_failed", "Запрос короче двух знаков");
  }
  if (query.length > 500) {
    throw new ApiError("validation_failed", "Запрос длиннее 500 знаков");
  }
  const kindsRaw = (c.req.query("kind") ?? "").split(",").map((k) => k.trim()).filter(Boolean);
  for (const kind of kindsRaw) {
    if (!KINDS.has(kind)) throw new ApiError("validation_failed", `Неизвестный вид куска: ${kind}`);
  }
  const kinds = kindsRaw.length ? kindsRaw : null;
  const type = c.req.query("type")?.trim() || null;
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 20) || 20, 1), 50);
  const drafts = canSeeDrafts(c.get("principal"));

  const vector = await embedQuery(query, c.get("requestId"));
  const rows = await sql`
    select s.entity_id as id, e.slug, e.title_ru, ty.code as type, ty.title_ru as type_title,
           app.entity_type_path(e.type_id) as type_path, e.status,
           s.kind as found_in, s.block_id, s.snippet, s.matched, s.similarity, s.score,
           app.compact_json(s.entity_id, ${drafts}) as compact
      from app.search(${query}, ${vector ? `[${vector.join(",")}]` : null}, ${drafts},
                      ${kinds}::text[], ${type}, ${SEARCH_HIDDEN_ROOTS}::text[], ${limit}) s
      join app.entities e on e.id = s.entity_id
      join app.entity_types ty on ty.id = e.type_id
     order by s.score desc, s.entity_id`;

  return c.json({ items: rows, mode: vector ? "hybrid" : "fulltext" });
});

search.get("/status", async (c: Context<AppEnv>) => {
  requirePermission(c.get("principal"), "edit");
  const [{ status }] = await sql<{ status: Record<string, unknown> }>`
    select app.search_status(${config.search.model}) as status`;
  return c.json({
    model: config.search.model,
    dimensions: config.search.dimensions,
    embeddings: embeddingsEnabled(),
    index: status,
    indexer: stats,
  });
});

/**
 * Пересборка кусков всех записей — после правки нарезки. Векторы кусков с
 * прежним текстом переносятся, в модель уходит только изменившееся.
 */
search.post("/reindex", async (c: Context<AppEnv>) => {
  requirePermission(c.get("principal"), "su");
  rebuildAll(c.get("requestId"));
  return c.json({ note: "Индекс пересобирается фоном; ход — GET /search/status" }, 202);
});
