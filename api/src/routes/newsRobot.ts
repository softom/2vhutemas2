/**
 * Страница работы робота новостей — только для `su` (WIKI/Новости — робот, цепочка и промпты).
 *
 * Робот — отдельный процесс на сервере (news-robot/, Python). Его папки
 * подключены к контейнеру API: прогоны и состояние — только для чтения,
 * ящик решений — для записи. API не меняет состояние робота: решение по
 * кандидату в источники или предложенный адрес ложится строкой в
 * inbox.jsonl, и робот применяет её при следующем запуске.
 */
import { Hono } from "hono";
import { ApiError } from "../lib/errors.ts";
import { require as requirePermission } from "../lib/auth.ts";
import type { AppEnv } from "../lib/http.ts";

export const newsRobot = new Hono<AppEnv>();

const ROOT = Deno.env.get("NEWS_ROBOT_DIR") ?? "/news-robot";
const RUN_ID = /^\d{8}-\d{6}$/;
const DOMAIN = /^[a-z0-9.-]+\.[a-z]{2,}$/;

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await Deno.readTextFile(path)) as T;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return null;
    throw e;
  }
}

interface Summary {
  id: string;
  finished_at: string;
  since: string;
  status: string;
  llm_note: string | null;
  counts: Record<string, number>;
  source_candidates?: unknown[];
}

newsRobot.get("/runs", async (c) => {
  requirePermission(c.get("principal"), "su");
  const ids: string[] = [];
  try {
    for await (const entry of Deno.readDir(`${ROOT}/out`)) {
      if (entry.isDirectory && RUN_ID.test(entry.name)) ids.push(entry.name);
    }
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return c.json({ items: [], connected: false });
    throw e;
  }
  ids.sort().reverse();
  const items = [];
  for (const id of ids.slice(0, 40)) {
    const s = await readJson<Summary>(`${ROOT}/out/${id}/summary.json`);
    items.push(s
      ? { id, finished_at: s.finished_at, since: s.since, status: s.status, llm_note: s.llm_note, counts: s.counts }
      : { id, status: "идёт или прерван без итога" });
  }
  return c.json({ items, connected: true });
});

newsRobot.get("/runs/:id", async (c) => {
  requirePermission(c.get("principal"), "su");
  const id = c.req.param("id");
  if (!RUN_ID.test(id)) throw new ApiError("validation_failed", "Неверный номер прогона");
  const s = await readJson<Summary>(`${ROOT}/out/${id}/summary.json`);
  if (!s) throw new ApiError("not_found", "Итога прогона нет");
  return c.json(s);
});

/** Кандидаты в источники — из текущего состояния робота, а не из последнего прогона. */
newsRobot.get("/candidates", async (c) => {
  requirePermission(c.get("principal"), "su");
  const state = await readJson<{ candidates?: Record<string, unknown> }>(`${ROOT}/state/state.json`);
  const pending: unknown[] = [];
  try {
    const text = await Deno.readTextFile(`${ROOT}/inbox/inbox.jsonl`);
    for (const line of text.split("\n")) if (line.trim()) pending.push(JSON.parse(line));
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  return c.json({ items: Object.values(state?.candidates ?? {}), pending });
});

/** Решение по кандидату или предложенный адрес — в ящик робота. */
newsRobot.post("/inbox", async (c) => {
  const principal = requirePermission(c.get("principal"), "su");
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const note = typeof body?.note === "string" ? body.note.slice(0, 500) : null;
  let msg: Record<string, unknown>;
  if (body?.action === "decide") {
    const domain = String(body.domain ?? "").toLowerCase();
    if (!DOMAIN.test(domain)) throw new ApiError("validation_failed", "Неверный домен");
    if (!["include", "once", "reject"].includes(String(body.decision))) {
      throw new ApiError("validation_failed", "Решение: include, once или reject");
    }
    msg = { action: "decide", domain, decision: body.decision, note };
  } else if (body?.action === "propose") {
    let url: URL;
    try {
      url = new URL(String(body.url ?? ""));
    } catch {
      throw new ApiError("validation_failed", "Нужен адрес сайта");
    }
    if (!["http:", "https:"].includes(url.protocol)) throw new ApiError("validation_failed", "Нужен адрес http(s)");
    msg = { action: "propose", url: url.toString(), note };
  } else {
    throw new ApiError("validation_failed", "action: decide или propose");
  }
  msg.by = principal.displayName;
  msg.contributor_id = principal.contributorId;
  msg.ts = new Date().toISOString();
  await Deno.writeTextFile(`${ROOT}/inbox/inbox.jsonl`, JSON.stringify(msg) + "\n", { append: true, create: true });
  return c.json({ queued: msg }, 202);
});
