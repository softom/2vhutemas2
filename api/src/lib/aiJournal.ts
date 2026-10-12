/**
 * Учёт платных обращений к моделям ИИ и поисковых запросов (Р-113).
 *
 * Запись в журнал не должна ни замедлять, ни ронять то, что она учитывает:
 * сбой журнала пишется в лог API, а поиск и ответ читателю идут дальше.
 */
import type { Context } from "hono";
import { config } from "./config.ts";
import { sql } from "./db.ts";
import { type AppEnv, log } from "./http.ts";

/** Кто вызвал: участник, гость под суточным псевдонимом или сам сервис. */
export interface Caller {
  contributorId: string | null;
  visitorKey: string | null;
  requestId: string;
}

export const SERVICE = (requestId: string): Caller => ({ contributorId: null, visitorKey: null, requestId });

/**
 * Псевдоним гостя на сутки: хеш адреса, браузера и даты с секретом сервера.
 * Сам адрес не хранится; на следующий день псевдоним другой.
 */
async function visitorKey(c: Context<AppEnv>): Promise<string | null> {
  const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "";
  if (!ip) return null;
  const day = new Date().toISOString().slice(0, 10);
  const source = `${ip}|${c.req.header("user-agent") ?? ""}|${day}|${config.auth.jwtSecret}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return Array.from(new Uint8Array(digest).slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function callerOf(c: Context<AppEnv>): Promise<Caller> {
  const principal = c.get("principal");
  return {
    contributorId: principal?.contributorId ?? null,
    visitorKey: principal ? null : await visitorKey(c),
    requestId: c.get("requestId"),
  };
}

interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
  cost_rub?: number;
}

export interface AiRequest {
  caller: Caller;
  purpose: "query_embedding" | "index_embedding" | "search_answer";
  model: string;
  items?: number;
  usage?: Usage | null;
  status: "ok" | "error";
  error?: string | null;
  output?: string | null;
  durationMs: number;
  searchQueryId?: string | null;
}

/** Строка журнала обращений к ИИ; не ждём её и не падаем из-за неё. */
export function recordAiRequest(entry: AiRequest): void {
  const usage = entry.usage ?? null;
  const cost = usage?.cost_rub ?? usage?.cost ?? null;
  sql`
    insert into app.ai_requests (contributor_id, visitor_key, search_query_id, purpose, provider, model,
                                 items, input_tokens, output_tokens, total_tokens, cost_rub, usage,
                                 status, error, output, duration_ms, request_id)
    values (${entry.caller.contributorId}::uuid, ${entry.caller.visitorKey}, ${entry.searchQueryId ?? null}::uuid,
            ${entry.purpose}, ${new URL(config.search.baseUrl).hostname}, ${entry.model},
            ${entry.items ?? null}::int, ${usage?.prompt_tokens ?? null}::int,
            ${usage?.completion_tokens ?? null}::int, ${usage?.total_tokens ?? null}::int,
            ${typeof cost === "number" ? cost : null}::numeric,
            ${usage ? JSON.stringify(usage) : null}::jsonb,
            ${entry.status}, ${entry.error?.slice(0, 1000) ?? null}, ${entry.output ?? null},
            ${Math.round(entry.durationMs)}::int, ${entry.caller.requestId})`
    .catch((error: unknown) =>
      log("error", entry.caller.requestId, "Обращение к ИИ не записано в журнал", { error: String(error) })
    );
}

export interface SearchLogEntry {
  caller: Caller;
  query: string;
  kinds: string[] | null;
  type: string | null;
  mode: "hybrid" | "fulltext";
  items: { id: unknown; found_in: unknown; score: unknown; matched: unknown }[];
  durationMs: number;
}

/** Строка журнала поиска; возвращает её номер или null, если журнал недоступен. */
export async function recordSearch(entry: SearchLogEntry): Promise<string | null> {
  try {
    const top = entry.items.slice(0, 10).map((i) => ({ id: Number(i.id), found_in: i.found_in, score: Number(i.score) }));
    const exact = entry.items.some((i) => Array.isArray(i.matched) && i.matched.includes("fulltext"));
    const [{ id }] = await sql<{ id: string }>`
      select app.search_log(${entry.caller.contributorId}::uuid, ${entry.caller.visitorKey}, ${entry.query},
                            ${entry.kinds}::text[], ${entry.type}, ${entry.mode}, ${entry.items.length}::int,
                            ${exact}, ${JSON.stringify(top)}::jsonb, ${Math.round(entry.durationMs)}::int,
                            ${entry.caller.requestId}) as id`;
    return id;
  } catch (error) {
    log("error", entry.caller.requestId, "Поисковый запрос не записан в журнал", { error: String(error) });
    return null;
  }
}
