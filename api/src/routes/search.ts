/**
 * Поиск (Р-109): гибридный — по словам и по смыслу.
 *
 * GET /search?q=…               выдача: запись, где найдено, фрагмент
 *   &kind=title,params,text     искать только в названиях / сведениях / тексте
 *   &type=<код ветви>           только в ветви дерева
 *   &limit=20
 * GET /search/status            состояние индекса (право edit)
 * POST /search/reindex          пересобрать куски всех записей (su)
 * POST /search/answer          ответ ИИ по материалам сайта со сносками (Р-114)
 * GET /search/queries           журнал поисковых запросов (su, Р-113)
 * GET /search/ai-requests       журнал обращений к ИИ и расход (su, Р-113)
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
import { callerOf, recordSearch } from "../lib/aiJournal.ts";
import { answerQuestion } from "../lib/searchAnswer.ts";

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

  const started = performance.now();
  const caller = await callerOf(c);
  const vector = await embedQuery(query, caller);
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

  const mode = vector ? "hybrid" : "fulltext";
  // Каждый запрос — в журнал (Р-113): кто искал, что нашлось. Сбой журнала поиск не роняет.
  const queryId = await recordSearch({
    caller, query, kinds, type, mode, durationMs: performance.now() - started,
    items: rows as { id: unknown; found_in: unknown; score: unknown; matched: unknown }[],
  });
  return c.json({ items: rows, mode, query_id: queryId });
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

/**
 * Ответ ИИ на вопрос (Р-114): только по материалам сайта, со сносками на записи.
 * Кому доступно и сколько раз в сутки — настройки сайта (SEARCH_AI_AUDIENCE,
 * SEARCH_AI_DAILY_LIMIT). Гость получает ответ по опубликованному.
 */
search.post("/answer", async (c: Context<AppEnv>) => {
  const body = await c.req.json().catch(() => ({})) as { q?: unknown };
  const question = typeof body.q === "string" ? body.q.trim() : "";
  if (question.length < 5) throw new ApiError("validation_failed", "Вопрос короче пяти знаков");
  if (question.length > 500) throw new ApiError("validation_failed", "Вопрос длиннее 500 знаков");
  const principal = c.get("principal");
  const result = await answerQuestion(question, principal, await callerOf(c), canSeeDrafts(principal),
    SEARCH_HIDDEN_ROOTS);
  return c.json(result);
});

function days(raw: string | undefined): number {
  return Math.min(Math.max(Number(raw ?? 30) || 30, 1), 365);
}

/**
 * Журнал поисковых запросов (Р-113): последние запросы с автором и сводка —
 * сколько искали и что не нашлось по словам (чего на сайте не хватает).
 */
search.get("/queries", async (c: Context<AppEnv>) => {
  requirePermission(c.get("principal"), "su");
  const period = days(c.req.query("days"));
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 100) || 100, 1), 500);
  const onlyMissed = c.req.query("missed") === "1";
  const items = await sql`
    select q.id, q.created_at, q.query, q.kinds, q.type_code, q.mode, q.results_count, q.exact, q.top,
           q.duration_ms, q.contributor_id, co.display_name as contributor, q.visitor_key
      from app.search_queries q
      left join app.contributors co on co.id = q.contributor_id
     where q.created_at > now() - make_interval(days => ${period}::int)
       and (not ${onlyMissed} or not q.exact)
     order by q.created_at desc
     limit ${limit}`;
  const [summary] = await sql`
    select count(*)::int as queries,
           count(*) filter (where not exact)::int as without_exact,
           count(*) filter (where results_count = 0)::int as empty,
           count(distinct contributor_id)::int as contributors,
           count(distinct visitor_key)::int as visitors
      from app.search_queries
     where created_at > now() - make_interval(days => ${period}::int)`;
  return c.json({ days: period, summary, items });
});

/** Журнал обращений к ИИ (Р-113): расход по назначению и модели и последние вызовы. */
search.get("/ai-requests", async (c: Context<AppEnv>) => {
  requirePermission(c.get("principal"), "su");
  const period = days(c.req.query("days"));
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 100) || 100, 1), 500);
  const totals = await sql`
    select purpose, model, count(*)::int as calls,
           count(*) filter (where status = 'error')::int as errors,
           coalesce(sum(total_tokens), 0)::bigint as tokens,
           sum(cost_rub) as cost_rub
      from app.ai_requests
     where created_at > now() - make_interval(days => ${period}::int)
     group by 1, 2 order by 1, 2`;
  const items = await sql`
    select a.id, a.created_at, a.purpose, a.model, a.items, a.input_tokens, a.output_tokens,
           a.total_tokens, a.cost_rub, a.status, a.error, a.duration_ms, a.search_query_id,
           a.contributor_id, co.display_name as contributor, a.visitor_key
      from app.ai_requests a
      left join app.contributors co on co.id = a.contributor_id
     where a.created_at > now() - make_interval(days => ${period}::int)
     order by a.created_at desc
     limit ${limit}`;
  return c.json({ days: period, totals, items });
});
