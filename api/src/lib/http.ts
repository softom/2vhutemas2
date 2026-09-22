/**
 * Общие части HTTP-слоя: сквозной идентификатор запроса, журналирование,
 * источники запросов и единый обработчик ошибок (правило 13 проекта).
 */
import type { Context, MiddlewareHandler, Next } from "hono";
import { config } from "./config.ts";
import { ApiError, fromDatabaseError } from "./errors.ts";
import type { Principal } from "./auth.ts";

export interface AppEnv {
  Variables: {
    requestId: string;
    principal: Principal | null;
  };
}

export function log(
  level: "info" | "warn" | "error",
  requestId: string,
  message: string,
  extra: Record<string, unknown> = {},
) {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    level,
    service: "api",
    request_id: requestId,
    message,
    ...extra,
  }));
}

/** Идентификатор запроса приходит от клиента или создаётся здесь. */
export const requestContext: MiddlewareHandler<AppEnv> = async (c: Context<AppEnv>, next: Next) => {
  const incoming = c.req.header("x-request-id");
  const requestId = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  c.set("requestId", requestId);
  c.header("x-request-id", requestId);

  const started = performance.now();
  await next();
  log("info", requestId, "request", {
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    duration_ms: Math.round(performance.now() - started),
  });
};

export const cors: MiddlewareHandler<AppEnv> = async (c: Context<AppEnv>, next: Next) => {
  const origin = c.req.header("origin");
  if (origin && config.corsOrigins.includes(origin)) {
    c.header("access-control-allow-origin", origin);
    c.header("vary", "origin");
    c.header("access-control-allow-headers", "authorization,content-type,if-match,x-request-id");
    c.header("access-control-allow-methods", "GET,POST,PATCH,DELETE,OPTIONS");
  }
  if (c.req.method === "OPTIONS") return c.body(null, 204);
  await next();
};

export function handleError(error: unknown, c: Context<AppEnv>) {
  const requestId = c.get("requestId") ?? "unknown";
  const apiError = error instanceof ApiError ? error : fromDatabaseError(error);

  if (apiError.status >= 500) {
    log("error", requestId, "unhandled", {
      error: error instanceof Error ? error.message : String(error),
    });
  } else {
    log("warn", requestId, "rejected", { code: apiError.code });
  }
  return c.json(apiError.toBody(requestId), apiError.status as 400);
}

/** Разбор курсора списка: непрозрачная для клиента строка с последним ID. */
export function decodeCursor(cursor: string | undefined): number | null {
  if (!cursor) return null;
  try {
    const value = Number(atob(cursor));
    return Number.isFinite(value) ? value : null;
  } catch {
    throw new ApiError("validation_failed", "Курсор списка повреждён");
  }
}

export function encodeCursor(lastId: number): string {
  return btoa(String(lastId));
}

export function pageSize(raw: string | undefined): number {
  const value = raw ? Number(raw) : config.pagination.defaultPageSize;
  if (!Number.isFinite(value) || value < 1) {
    throw new ApiError("validation_failed", "Размер страницы должен быть положительным числом");
  }
  return Math.min(value, config.pagination.maxPageSize);
}
