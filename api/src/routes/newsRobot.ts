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

/** Начало прогона — время первой строки журнала; без журнала — по номеру. */
async function runStart(id: string): Promise<string> {
  try {
    const file = await Deno.open(`${ROOT}/out/${id}/log.jsonl`);
    const buf = new Uint8Array(400);
    const n = await file.read(buf);
    file.close();
    const ts = /"ts": ?"([^"]+)"/.exec(new TextDecoder().decode(buf.subarray(0, n ?? 0)))?.[1];
    if (ts) return ts;
  } catch {
    // нет журнала — ниже
  }
  return `${id.slice(0, 4)}-${id.slice(4, 6)}-${id.slice(6, 8)}T${id.slice(9, 11)}:${id.slice(11, 13)}:${id.slice(13, 15)}+00:00`;
}

/**
 * Прогоны по времени начала, новые первыми. Номер прогона — местное время машины, где он шёл:
 * перенесённые с машины разработчика — МСК, серверные — UTC, поэтому по номеру сортировать нельзя
 * (догоняющий прогон 2026-10-03 из-за этого не открывался по умолчанию).
 */
async function runIds(): Promise<string[]> {
  const ids: string[] = [];
  try {
    for await (const entry of Deno.readDir(`${ROOT}/out`)) {
      if (!entry.isDirectory || !RUN_ID.test(entry.name)) continue;
      // Папка без журнала — прогон, упавший до первой строки; в списке и в «Состоянии» он только путает.
      try {
        if ((await Deno.stat(`${ROOT}/out/${entry.name}/log.jsonl`)).size > 0) ids.push(entry.name);
      } catch {
        // журнала нет
      }
    }
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  const starts = await Promise.all(ids.map(async (id) => [id, new Date(await runStart(id)).getTime()] as const));
  return starts.sort((a, b) => b[1] - a[1]).map(([id]) => id);
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
    runs.push({ id, done, started_at: await runStart(id) });
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
    orders_pending: await pendingOrders(),
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
        order: rec.order ? { topic: (rec.order as Row).topic, section: (rec.order as Row).section,
          by: (rec.order as Row).by, at: (rec.order as Row).at } : undefined,
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

/**
 * Состояние робота (Р-103): идёт ли сбор, что делает минутное задание, как работает LLM.
 * Источники — журнал последнего прогона, .state/heartbeat.json, .state/llm_calls.jsonl.
 */
newsRobot.get("/health", async (c) => {
  requirePermission(c.get("principal"), "su");
  const now = Date.now();
  const ids = await runIds();
  const lastId = ids[0];
  let crawl: Row = { state: "нет прогонов" };
  if (lastId) {
    const log = await logLines(lastId);
    const last = log[log.length - 1] ?? {};
    const done = (await readJson<Row>(`${ROOT}/out/${lastId}/summary.json`)) !== null;
    const lastTs = last.ts ? new Date(String(last.ts)).getTime() : 0;
    const progress = await readJson<Row>(`${ROOT}/out/${lastId}/progress.json`);
    crawl = {
      run_id: lastId, started_at: await runStart(lastId), last_at: last.ts ?? null,
      state: done ? "ждёт расписания" : now - lastTs < 10 * 60000 ? "идёт" : "прерван или завис",
      stage: last.stage ?? null, msg: last.msg ?? null, stages: progress?.stages ?? null,
    };
  }
  // Следующий плановый прогон — 04:00 UTC (07:00 МСК), news.crawl.schedule.
  const next = new Date();
  next.setUTCHours(4, 0, 0, 0);
  if (next.getTime() <= now) next.setUTCDate(next.getUTCDate() + 1);
  crawl.next_at = next.toISOString();

  const beat = await readJson<{ ts: string; doing: string }>(`${ROOT}/state/heartbeat.json`);
  const beatAge = beat ? Math.round((now - new Date(beat.ts).getTime()) / 1000) : null;
  const worker = {
    last_at: beat?.ts ?? null, age_s: beatAge, doing: beat?.doing ?? null,
    state: beatAge === null ? "ещё не запускалось" : beatAge < 180 ? "работает" : "не отвечает",
  };

  const calls: Row[] = [];
  try {
    const text = await Deno.readTextFile(`${ROOT}/state/llm_calls.jsonl`);
    for (const line of text.split("\n").slice(-3000)) {
      if (!line.trim()) continue;
      try {
        calls.push(JSON.parse(line));
      } catch {
        // битая строка журнала — пропускаем
      }
    }
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  const day = calls.filter((x) => now - new Date(String(x.ts)).getTime() < 86400000);
  const lastCall = calls[calls.length - 1] ?? null;
  const lastCallAge = lastCall ? Math.round((now - new Date(String(lastCall.ts)).getTime()) / 1000) : null;
  const llm = {
    model: lastCall?.model ?? null, last: lastCall, age_s: lastCallAge,
    state: !lastCall ? "вызовов ещё не было" : lastCall.ok === false ? "ошибка последнего вызова" : "отвечает",
    day: {
      calls: day.length, errors: day.filter((x) => x.ok === false).length,
      prompt_tokens: day.reduce((n, x) => n + Number(x.prompt_tokens ?? 0), 0),
      completion_tokens: day.reduce((n, x) => n + Number(x.completion_tokens ?? 0), 0),
    },
    recent: calls.slice(-15).reverse(),
  };
  return c.json({ now: new Date(now).toISOString(), crawl, worker, llm });
});

/**
 * «Заказать новость» (Р-104): тема, раздел, ссылки и текст редактора, указание.
 * Робот возьмёт заказ в течение минуты; новость появится в разделе «Новости» строкой заказа.
 */
newsRobot.post("/order", async (c) => {
  const principal = requirePermission(c.get("principal"), "su");
  const body = await c.req.json().catch(() => null) as Row | null;
  const topic = typeof body?.topic === "string" ? body.topic.trim().slice(0, 200) : "";
  if (!topic) throw new ApiError("validation_failed", "Нужна тема: о чём новость");
  const section = ["architecture", "neurogeneration", "software"].includes(String(body?.section))
    ? String(body?.section) : "neurogeneration";
  const urls: string[] = [];
  const text: string[] = [];
  for (const line of String(body?.input ?? "").slice(0, 20000).split("\n")) {
    const t = line.trim();
    if (!t) continue;
    if (/^https?:\/\/\S+$/.test(t) && urls.length < 6) urls.push(t);
    else text.push(t);
  }
  if (!urls.length) throw new ApiError("validation_failed", "Нужна хотя бы одна ссылка: робот пишет по источникам, а не по памяти");
  const translit: Record<string, string> = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i",
    й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts",
    ч: "ch", ш: "sh", щ: "shch", ы: "y", э: "e", ю: "yu", я: "ya" };
  const base = [...topic.toLowerCase()].map((ch) => translit[ch] ?? ch).join("").replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, 60) || "zakaz";
  const key = `zakaz-${base}-${crypto.randomUUID().slice(0, 4)}`;
  const note = typeof body?.note === "string" ? body.note.slice(0, 2000) : "";
  const req = { story_key: key, topic, section, urls, text: text.join("\n"), note, by: principal.displayName,
    at: new Date().toISOString() };
  await Deno.mkdir(`${ROOT}/inbox/orders`, { recursive: true });
  await Deno.writeTextFile(`${ROOT}/inbox/orders/${key}.json`, JSON.stringify(req));
  return c.json({ queued: req }, 202);
});

/** Заказы, ещё не взятые роботом (ящик inbox/orders). */
async function pendingOrders(): Promise<Row[]> {
  const list: Row[] = [];
  try {
    for await (const entry of Deno.readDir(`${ROOT}/inbox/orders`)) {
      if (entry.isFile && entry.name.endsWith(".json")) {
        const r = await readJson<Row>(`${ROOT}/inbox/orders/${entry.name}`);
        if (r) list.push(r);
      }
    }
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  return list;
}
