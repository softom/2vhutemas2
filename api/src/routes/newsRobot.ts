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
const STORY = /^[a-z0-9][a-z0-9-]{0,99}$/;

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

/**
 * Журнал прогона с нужной строки и живое состояние: страница опрашивает его,
 * пока прогон идёт (итога summary.json ещё нет).
 */
newsRobot.get("/runs/:id/log", async (c) => {
  requirePermission(c.get("principal"), "su");
  const id = c.req.param("id");
  if (!RUN_ID.test(id)) throw new ApiError("validation_failed", "Неверный номер прогона");
  const from = Math.max(0, Number(c.req.query("from") ?? 0) || 0);
  let lines: string[] = [];
  try {
    lines = (await Deno.readTextFile(`${ROOT}/out/${id}/log.jsonl`)).split("\n").filter((l) => l.trim());
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  const items = lines.slice(from, from + 500).map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return { msg: l };
    }
  });
  const progress = await readJson<Record<string, unknown>>(`${ROOT}/out/${id}/progress.json`);
  let running = true;
  try {
    await Deno.stat(`${ROOT}/out/${id}/summary.json`);
    running = false;
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  return c.json({ items, next: from + items.length, total: lines.length, progress, running });
});

/** Список источников: настройка и состояние обхода (снимок робота .state/sources.json). */
newsRobot.get("/sources", async (c) => {
  requirePermission(c.get("principal"), "su");
  const items = await readJson<unknown[]>(`${ROOT}/state/sources.json`);
  return c.json({ items: items ?? [], connected: items !== null });
});

/** Кандидаты в источники — из текущего состояния робота, а не из последнего прогона. */
newsRobot.get("/candidates", async (c) => {
  requirePermission(c.get("principal"), "su");
  const state = await readJson<{ candidates?: Record<string, unknown>; learned?: Record<string, unknown> }>(
    `${ROOT}/state/state.json`,
  );
  const pending: unknown[] = [];
  try {
    const text = await Deno.readTextFile(`${ROOT}/inbox/inbox.jsonl`);
    for (const line of text.split("\n")) if (line.trim()) pending.push(JSON.parse(line));
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  const learned = state?.learned ?? null;
  return c.json({ items: Object.values(state?.candidates ?? {}), pending, learned });
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
  } else if (body?.action === "judge") {
    // Решение редактора по истории: «выпустил бы» или «нет» — по нему робот учит ранжирование (Р-93).
    const story = String(body.story_key ?? "");
    const run = String(body.run_id ?? "");
    if (!STORY.test(story) || !RUN_ID.test(run)) throw new ApiError("validation_failed", "Неверная история или прогон");
    if (!["yes", "no"].includes(String(body.verdict))) throw new ApiError("validation_failed", "Решение: yes или no");
    msg = { action: "judge", story_key: story, run_id: run, verdict: body.verdict, note };
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
    throw new ApiError("validation_failed", "action: decide, judge или propose");
  }
  msg.by = principal.displayName;
  msg.contributor_id = principal.contributorId;
  msg.ts = new Date().toISOString();
  await Deno.writeTextFile(`${ROOT}/inbox/inbox.jsonl`, JSON.stringify(msg) + "\n", { append: true, create: true });
  return c.json({ queued: msg }, 202);
});

// ── Раздел «Робот» сайта: сводка, вид прогона, стек на публикацию (Р-96) ─

type Row = Record<string, unknown>;

async function logLines(id: string): Promise<Row[]> {
  try {
    const text = await Deno.readTextFile(`${ROOT}/out/${id}/log.jsonl`);
    return text.split("\n").filter((l) => l.trim()).flatMap((l) => {
      try {
        return [JSON.parse(l) as Row];
      } catch {
        return [];
      }
    });
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return [];
    throw e;
  }
}

async function runIds(): Promise<string[]> {
  const ids: string[] = [];
  try {
    for await (const entry of Deno.readDir(`${ROOT}/out`)) {
      if (entry.isDirectory && RUN_ID.test(entry.name)) ids.push(entry.name);
    }
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  return ids.sort().reverse();
}

/** Слоты выхода — news.release.slots проекта; время московское. */
const SLOTS = (Deno.env.get("NEWS_RELEASE_SLOTS") ?? "09:30,13:00,18:00").split(",").map((s) => s.trim());
const QUEUE = () => `${ROOT}/inbox/queue.json`;

interface QueueItem {
  story_key: string;
  run_id?: string;
  title?: string;
  topic?: string;
  final?: number;
  url?: string;
  date: string;
  time: string;
  added_at: string;
  by?: string;
}

function moscowNow(): Date {
  return new Date(Date.now() + 3 * 3600 * 1000);
}

async function readQueue() {
  const stored = await readJson<{ items: QueueItem[] }>(QUEUE());
  const today = moscowNow();
  // Две недели вперёд: три слота в день, четырёх дней хватило на один вечер отбора (2026-10-03).
  const days = Array.from({ length: 15 }, (_, i) => new Date(today.getTime() + i * 86400000).toISOString().slice(0, 10));
  return { items: stored?.items ?? [], times: SLOTS, days };
}

/** Сводка раздела: прогоны, сайты, рекомендации, решения, выученное, стек. */
newsRobot.get("/overview", async (c) => {
  requirePermission(c.get("principal"), "su");
  const ids = await runIds();
  const runs = [];
  for (const id of ids.slice(0, 30)) {
    let done = true;
    try {
      await Deno.stat(`${ROOT}/out/${id}/summary.json`);
    } catch {
      done = false;
    }
    runs.push({ id, done });
  }
  const state = await readJson<
    { candidates?: Record<string, Row>; judgments?: Record<string, Row>; learned?: Row }
  >(`${ROOT}/state/state.json`);
  const pending: Row[] = [];
  try {
    for (const line of (await Deno.readTextFile(`${ROOT}/inbox/inbox.jsonl`)).split("\n")) {
      if (line.trim()) pending.push(JSON.parse(line));
    }
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  const open = (s: unknown) => s === "новый" || s === "ждёт решения";
  const candidates = Object.values(state?.candidates ?? {}).sort((a, b) =>
    Number(!open(a.status)) - Number(!open(b.status)) || Number(b.count ?? 0) - Number(a.count ?? 0)
  );
  const learned = { ...(state?.learned ?? {}) };
  delete learned.history;
  return c.json({
    connected: state !== null || runs.length > 0,
    runs,
    sources: (await readJson<Row[]>(`${ROOT}/state/sources.json`)) ?? [],
    candidates,
    judged: Object.fromEntries(Object.entries(state?.judgments ?? {}).map(([k, v]) => [k, v.verdict])),
    pending,
    learned,
    queue: await readQueue(),
    prepared: await preparedIndex(),
  });
});

/**
 * Подготовка к публикации (Р-97): «В стек» → робот переводит и готовит новость →
 * в колонке «Публикация» слот и ссылка на превью. Файлы — .state/prepared/<история>.json.
 */
async function preparedIndex(): Promise<Record<string, Row>> {
  const index: Record<string, Row> = {};
  try {
    for await (const entry of Deno.readDir(`${ROOT}/state/prepared`)) {
      if (!entry.isFile || !entry.name.endsWith(".json")) continue;
      const rec = await readJson<Row & { story?: { news?: { title?: string }; issues?: string[]; warnings?: string[] } }>(
        `${ROOT}/state/prepared/${entry.name}`,
      );
      if (!rec) continue;
      index[String(rec.story_key)] = {
        status: rec.status, ready_at: rec.ready_at, started_at: rec.started_at, error: rec.error,
        origin: rec.origin, title: rec.story?.news?.title,
        // Замечания и предупреждения, кроме «фото без автора» и «перепечатка» — они видны в превью.
        issues: [...(rec.story?.issues ?? []), ...(rec.story?.warnings ?? [])]
          .filter((x) => !x.startsWith("фото без автора") && !x.startsWith("перепечатка")),
      };
    }
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  return index;
}

newsRobot.get("/prepared/:key", async (c) => {
  requirePermission(c.get("principal"), "su");
  const key = c.req.param("key");
  if (!STORY.test(key)) throw new ApiError("validation_failed", "Неверная история");
  const rec = await readJson<Row>(`${ROOT}/state/prepared/${key}.json`);
  if (!rec) throw new ApiError("not_found", "Новость ещё не подготовлена");
  return c.json(rec);
});

/** Вид прогона: итог, а пока его нет — собранное из журнала и промежуточных файлов робота. */
newsRobot.get("/runs/:id/view", async (c) => {
  requirePermission(c.get("principal"), "su");
  const id = c.req.param("id");
  if (!RUN_ID.test(id)) throw new ApiError("validation_failed", "Неверный номер прогона");
  const dir = `${ROOT}/out/${id}`;
  const summary = await readJson<Row & { feeds: Row[]; candidates: Row[]; news: Row[] }>(`${dir}/summary.json`);
  const log = await logLines(id);
  const progress = await readJson<{ stages?: Record<string, [number, number]> }>(`${dir}/progress.json`);
  const sources = (await readJson<Row[]>(`${ROOT}/state/sources.json`)) ?? [];
  const titles = Object.fromEntries(sources.map((s) => [s.id, s.title]));
  const start = log.find((r) => r.msg === "старт") ?? {};
  const feeds = summary?.feeds ?? log.filter((r) => r.stage === "crawl" && r.source).map((r) => ({
    id: r.source,
    title: titles[String(r.source)] ?? r.source,
    status: r.error ? `ошибка: ${r.error}` : "ok",
    items: r.items ?? 0,
    new: r.new ?? 0,
  }));
  const candidates = summary?.candidates ?? (await readJson<Row[]>(`${dir}/candidates.json`)) ?? [];
  const partial = candidates.length ? [] : (await readJson<Row[]>(`${dir}/triage_partial.json`)) ?? [];
  const news = summary?.news ?? ((await readJson<Row[]>(`${dir}/news.json`)) ?? []).map((s) => ({
    candidate: s.candidate,
    news: s.news,
    issues: s.issues ?? [],
    warnings: s.warnings ?? [],
  }));
  const items = ((await readJson<unknown[]>(`${dir}/items.json`)) ?? []).length;
  const batches = log.filter((r) => r.stage === "triage" && String(r.msg).startsWith("пачка"));
  const written = log.filter((r) => r.stage === "write").length;
  const stages = progress?.stages ?? {
    crawl: [feeds.length, Number(start.sources ?? feeds.length)],
    triage: [batches.reduce((n, r) => n + Number(r.size ?? 0), 0), items],
    write: [written, Math.max(written, news.length)],
  };
  const last = log[log.length - 1] ?? {};
  return c.json({
    id,
    running: summary === null,
    status: summary?.status ?? "идёт",
    since: summary?.since ?? start.since,
    llm_note: summary?.llm_note ?? null,
    last: { ts: last.ts, stage: last.stage, msg: last.msg },
    stages,
    items,
    feeds,
    candidates,
    partial,
    news,
    link_domains: summary?.link_domains ?? [],
    errors: log.filter((r) => r.level === "warn" || r.level === "error").slice(-30),
  });
});

/** Стек на публикацию: слоты выхода по дням. Стек принадлежит редактору (WIKI/Новости.md, раздел 5). */
newsRobot.post("/queue", async (c) => {
  const principal = requirePermission(c.get("principal"), "su");
  const body = await c.req.json().catch(() => null) as Row | null;
  const q = await readQueue();
  const key = String(body?.story_key ?? "");
  if (!STORY.test(key)) throw new ApiError("validation_failed", "Неверная история");
  const taken = new Set(q.items.filter((i) => i.story_key !== key).map((i) => `${i.date} ${i.time}`));
  if (body?.action === "add") {
    if (q.items.some((i) => i.story_key === key)) throw new ApiError("duplicate", "История уже в стеке");
    const now = moscowNow().toISOString().slice(0, 16).replace("T", " ");
    const free = q.days.flatMap((d) => q.times.map((t) => `${d} ${t}`)).find((s) => !taken.has(s) && s > now);
    if (!free) throw new ApiError("validation_failed", "Свободных слотов на ближайшие дни нет");
    const [date, time] = free.split(" ");
    const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 300) : undefined);
    q.items.push({
      story_key: key, run_id: str(body.run_id), title: str(body.title), topic: str(body.topic),
      final: typeof body.final === "number" ? body.final : undefined, url: str(body.url),
      date, time, added_at: new Date().toISOString(), by: principal.displayName,
    });
  } else if (body?.action === "move") {
    const date = String(body.date ?? ""), time = String(body.time ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !q.times.includes(time)) {
      throw new ApiError("validation_failed", "Время — только из слотов выхода");
    }
    const mine = q.items.find((i) => i.story_key === key);
    if (!mine) throw new ApiError("not_found", "Истории нет в стеке");
    const other = q.items.find((i) => i.date === date && i.time === time && i.story_key !== key);
    if (other) [other.date, other.time] = [mine.date, mine.time];
    [mine.date, mine.time] = [date, time];
  } else if (body?.action === "remove") {
    q.items = q.items.filter((i) => i.story_key !== key);
  } else {
    throw new ApiError("validation_failed", "action: add, move или remove");
  }
  q.items.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  const tmp = `${QUEUE()}.tmp`;
  await Deno.writeTextFile(tmp, JSON.stringify({ items: q.items }, null, 1));
  await Deno.rename(tmp, QUEUE());
  return c.json(await readQueue());
});

/**
 * «Перегенерировать с учётом замечаний» (Р-101): замечания прошлой версии, указание редактора,
 * его ссылки (дополнительные источники текста и фото) и текст. Робот берёт запрос в течение минуты.
 */
newsRobot.post("/regenerate", async (c) => {
  const principal = requirePermission(c.get("principal"), "su");
  const body = await c.req.json().catch(() => null) as Row | null;
  const key = String(body?.story_key ?? "");
  if (!STORY.test(key)) throw new ApiError("validation_failed", "Неверная история");
  if (!(await readJson<Row>(`${ROOT}/state/prepared/${key}.json`))) {
    throw new ApiError("not_found", "Новость ещё не подготовлена — перегенерировать нечего");
  }
  const raw = typeof body?.input === "string" ? body.input.slice(0, 20000) : "";
  const urls: string[] = [];
  const text: string[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    if (/^https?:\/\/\S+$/.test(t) && urls.length < 5) urls.push(t);
    else text.push(t);
  }
  const note = typeof body?.note === "string" ? body.note.slice(0, 2000) : "";
  const req = { story_key: key, urls, text: text.join("\n"), note, by: principal.displayName, at: new Date().toISOString() };
  await Deno.mkdir(`${ROOT}/inbox/regenerate`, { recursive: true });
  await Deno.writeTextFile(`${ROOT}/inbox/regenerate/${key}.json`, JSON.stringify(req));
  return c.json({ queued: req }, 202);
});
