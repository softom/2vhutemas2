/**
 * Раздел «Робот» — только `su` (Р-92…Р-94, Р-96).
 *
 * Робот новостей — отдельный процесс на сервере (news-robot/). Здесь
 * редактор видит его работу и управляет ею. Подменю раздела:
 * обзор (прогресс этапов, обучение), новости (отбор, перевод, ранжирование),
 * стек на публикацию (слоты выхода по дням), сайты мониторинга,
 * рекомендации к добавлению, журнал. Пока прогон идёт, страница
 * обновляется каждые три секунды.
 *
 * Решения «да / нет» и по сайтам уходят роботу в ящик и применяются при
 * следующем запуске; стек принадлежит редактору и меняется сразу.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  api,
  type RobotHealth,
  type RobotLearned,
  type RobotLogLine,
  type RobotOverview,
  type RobotPreparedFull,
  type RobotRunView,
  type RobotSourceCandidate,
  type RobotSourceRow,
  type RobotStory,
} from "../api";

const SECTIONS: [string, string][] = [
  ["", "Обзор"], ["news", "Новости"], ["stack", "Стек"], ["sites", "Сайты"], ["recs", "Рекомендации"], ["log", "Журнал"],
];
const TOPIC: Record<string, string> = { architecture: "Архитектура", neurogeneration: "Нейрогенерация", software: "ПО" };
const KIND: Record<string, string> = {
  building: "здание", material: "материал", tool: "инструмент", competition: "конкурс", education: "образование",
  award: "премия", research: "исследование", event: "событие", business: "бизнес", policy: "политика", other: "прочее",
};
const STAGE: Record<string, string> = {
  run: "прогон", inbox: "решения", learn: "обучение", crawl: "сбор", triage: "отбор LLM", write: "текст",
  discover: "источники", notify: "уведомление",
};
const RECOMMEND: Record<string, string> = { include: "включить", once: "разово", skip: "не нужен" };
const LINK_KIND: Record<string, string> = { primary: "первоисточник", news_portal: "издание", research: "исследование" };
const OPEN = new Set(["новый", "ждёт решения"]);

function when(iso?: string | null) {
  return iso ? new Date(iso).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }) : "—";
}

export function NewsRobot({ allowed }: { allowed: boolean }) {
  const { section = "", key } = useParams();
  const [ov, setOv] = useState<RobotOverview | null>(null);
  const [health, setHealth] = useState<RobotHealth | null>(null);
  const [run, setRun] = useState<RobotRunView | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const preparing = useRef(false);

  const refresh = useCallback(async () => {
    clearTimeout(timer.current);
    let running = false;
    try {
      const [o, h] = await Promise.all([api.robotOverview(), api.robotHealth().catch(() => null)]);
      setOv(o);
      setHealth(h);
      preparing.current = o.queue.items.some((i) => !["готово", "ошибка"].includes(o.prepared[i.story_key]?.status ?? ""))
        || Object.values(o.prepared).some((p) => Boolean(p.cover?.pending)
          || ["промпт готовится", "генерируется"].includes(p.cover?.status ?? ""));
      const id = runId ?? o.runs[0]?.id ?? null;
      if (id && id !== runId) setRunId(id);
      if (id) {
        const r = await api.robotRunView(id);
        setRun(r);
        running = r.running;
      }
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
    // Идёт прогон или в стеке есть новость в переводе — обновляем часто.
    timer.current = setTimeout(refresh, running || preparing.current ? 3000 : 20000);
  }, [runId]);

  useEffect(() => {
    if (!allowed) return;
    refresh();
    return () => clearTimeout(timer.current);
  }, [allowed, refresh]);

  if (!allowed) return <p className="error">Раздел робота доступен только суперпользователю.</p>;

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn();
      if (done) setStatus(done);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section className="robot">
      <h1>Робот новостей</h1>
      <nav className="robot-tabs filters" aria-label="Разделы робота">
        {SECTIONS.map(([code, title]) => (
          <Link key={code} to={code ? `/robot/${code}` : "/robot"} className={section === code ? "active" : undefined}>
            {title}
          </Link>
        ))}
        {ov && ov.runs.length > 0 && (
          <select value={runId ?? ""} onChange={(e) => setRunId(e.target.value)} aria-label="Прогон">
            {ov.runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.started_at ? new Date(r.started_at).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) + " МСК" : r.id}
                {r.done ? "" : " — идёт"}
              </option>
            ))}
          </select>
        )}
      </nav>
      {health && <Health h={health} />}
      {error && <p className="error">{error}</p>}
      {status && <p className="notice">{status}</p>}
      {ov && !ov.connected && <p className="notice">Папки робота на сервере не подключены к API.</p>}
      {ov && run && <Progress ov={ov} run={run} />}
      {ov && run && section === "" && <Overview ov={ov} run={run} />}
      {ov && run && section === "news" && <News ov={ov} run={run} act={act} />}
      {ov && section === "stack" && <Stack ov={ov} act={act} />}
      {ov && section === "sites" && <Sites ov={ov} run={run} />}
      {ov && section === "recs" && <Recs ov={ov} act={act} />}
      {run && section === "log" && <LogView key={run.id} runId={run.id} live={run.running} />}
      {ov && section === "preview" && key && <Preview storyKey={key} ov={ov} />}
      {ov && !ov.runs.length && <p className="notice">Прогонов пока не было.</p>}
    </section>
  );
}

type Act = (fn: () => Promise<unknown>, done?: string) => Promise<void>;

function ago(s: number | null | undefined) {
  if (s == null) return "—";
  if (s < 90) return `${s} с назад`;
  if (s < 5400) return `${Math.round(s / 60)} мин назад`;
  return `${Math.round(s / 3600)} ч назад`;
}

/** Панель «Состояние» (Р-103): работает ли сбор, минутное задание и LLM — и чем заняты. */
function Health({ h }: { h: RobotHealth }) {
  const at = (iso?: string | null) => iso ? new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
  const ok = (good: boolean) => ({ color: good ? "#2f6f3e" : "var(--accent)" });
  const c = h.crawl, w = h.worker, l = h.llm;
  return (
    <div className="robot-bars">
      <div className="block robot-bar">
        <h3>Сбор — «червяк»</h3>
        <p style={ok(c.state !== "прерван или завис")}><b>{c.state}</b></p>
        <p className="hint">
          {c.state === "идёт" ? <>{STAGE[c.stage ?? ""] ?? c.stage}: {c.msg} · {at(c.last_at)}</> : <>последний прогон {at(c.started_at)}</>}
          <br />следующий по расписанию: {at(c.next_at)}
        </p>
      </div>
      <div className="block robot-bar">
        <h3>Подготовка и публикатор</h3>
        <p style={ok(w.state === "работает")}><b>{w.state}</b> <span className="hint">· {ago(w.age_s)}</span></p>
        <p className="hint">{w.doing ?? "—"}<br />каждую минуту: перевод по стеку, черновики, выход в слот</p>
      </div>
      <div className="block robot-bar">
        <h3>LLM — {l.model ?? "DeepSeek"} через Polza.AI</h3>
        <p style={ok(l.state === "отвечает")}><b>{l.state}</b> <span className="hint">· последний вызов {ago(l.age_s)}</span></p>
        <p className="hint">
          {l.last ? <>{l.last.stage}{l.last.where ? ` (${l.last.where})` : ""} · {Math.round((l.last.ms ?? 0) / 1000)} с{l.last.error ? ` · ${l.last.error}` : ""}<br /></> : null}
          за сутки: вызовов {l.day.calls}, ошибок {l.day.errors}, токенов {l.day.prompt_tokens + l.day.completion_tokens}
        </p>
        {l.recent.length > 0 && (
          <details>
            <summary className="hint">последние вызовы</summary>
            <ul className="hint">
              {l.recent.map((x, i) => (
                <li key={i} style={x.ok ? undefined : { color: "var(--accent)" }}>
                  {at(x.ts)} · {x.stage} · {Math.round((x.ms ?? 0) / 1000)} с{x.ok ? "" : ` · ${x.error ?? "обрезан"}`}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}

function Bar({ title, done, total, sub }: { title: string; done: number; total: number; sub: string }) {
  const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className="block robot-bar">
      <h3>{title}</h3>
      <p><b>{done}</b> <span className="hint">/ {total}</span></p>
      <div className={`robot-meter${total && done >= total ? " done" : ""}`}><i style={{ width: `${pct}%` }} /></div>
      <p className="hint">{sub}</p>
    </div>
  );
}

function Progress({ ov, run }: { ov: RobotOverview; run: RobotRunView }) {
  const st = run.stages ?? {};
  const [cd, ct] = st.crawl ?? [0, 0], [td, tt] = st.triage ?? [0, 0], [wd, wt] = st.write ?? [0, 0];
  const failed = run.feeds.filter((f) => f.status.startsWith("ошибка")).length;
  const q = ov.queue;
  return (
    <>
      <div className="robot-bars">
        <Bar title="Сайты — сбор" done={cd} total={ct} sub={`новых материалов ${run.items}${failed ? ` · ошибок ${failed}` : ""}`} />
        <Bar title="Отбор и ранжирование" done={td} total={tt} sub={`историй после склейки ${run.candidates.length || "—"}`} />
        <Bar title="Перевод — тексты" done={wd} total={wt} sub={`готово ${run.news.filter((n) => n.news).length}`} />
        <Bar title="Стек на публикацию" done={q.items.length} total={q.days.length * q.times.length}
          sub={`${q.days.length} дня × ${q.times.join(", ")}`} />
      </div>
      <p className="hint">
        {run.running
          ? <><b>Идёт прогон.</b> {STAGE[run.last.stage ?? ""] ?? run.last.stage}: {run.last.msg} · {(run.last.ts ?? "").slice(11, 19)} UTC · обновляется каждые 3 с</>
          : <>Прогон {run.id} закончен: {run.status}. {run.llm_note}</>}
      </p>
    </>
  );
}

function Overview({ ov, run }: { ov: RobotOverview; run: RobotRunView }) {
  const openRecs = ov.candidates.filter((c) => OPEN.has(c.status)).length;
  return (
    <>
      <ul>
        <li><Link to="/robot/news">Новости</Link>: историй {run.candidates.length}, переведено {run.news.filter((n) => n.news).length}</li>
        <li><Link to="/robot/stack">Стек</Link>: в стеке {ov.queue.items.length}</li>
        <li><Link to="/robot/sites">Сайты</Link>: включено {ov.sources.filter((s) => s.enabled).length} из {ov.sources.length}</li>
        <li><Link to="/robot/recs">Рекомендации</Link>: ждут решения {openRecs}</li>
        <li><Link to="/robot/log">Журнал</Link>: предупреждений и ошибок {run.errors.length}</li>
      </ul>
      <h2>Как робот понимает ваш выбор</h2>
      <Learning learned={ov.learned} />
    </>
  );
}

function News({ ov, run, act }: { ov: RobotOverview; run: RobotRunView; act: Act }) {
  const inStack = new Set(ov.queue.items.map((i) => i.story_key));
  const pendingVerdict = Object.fromEntries(ov.pending.filter((p) => p.action === "judge" && p.story_key)
    .map((p) => [p.story_key!, p.verdict]));
  // Истории из всех прогонов за две недели (Р-105); пока список не пришёл — текущий прогон.
  type Row = RobotStory & { partial?: boolean; run_id?: string; run_started?: string; written?: boolean };
  const [stories, setStories] = useState<Row[] | null>(null);
  useEffect(() => {
    api.robotStories(14).then((r) => setStories(r.items)).catch(() => setStories(null));
  }, [run.id, run.candidates.length, ov.queue.items.length]);
  const runRows: Row[] = run.candidates.length ? run.candidates : run.partial.map((p) => ({
    story_key: p.story_key ?? p.id ?? "", final: p.interest ?? 0, interest: p.interest ?? 0, title_ru: p.title_ru ?? p.title ?? "",
    topic: p.topic, kind: p.kind, reason: p.reason, competition: p.competition,
    sources: [{ source: p.source ?? "", url: p.url ?? "" }], partial: true,
  }));
  const allRows: Row[] = (stories ?? runRows).slice().sort((a, b) => b.final - a.final);
  // Просмотрена — есть ваше «Да / Нет» или история в стеке.
  const reviewed = (c: Row) => Boolean(ov.judged[c.story_key] ?? pendingVerdict[c.story_key]) || inStack.has(c.story_key);
  const [view, setView] = useState<"new" | "seen" | "all">("new");
  const rows = allRows.filter((c) => view === "all" || (view === "new" ? !reviewed(c) : reviewed(c)));
  const [topic, setTopic] = useState("");
  // Ответ — прямо в строке: сообщение вверху страницы из середины таблицы не видно.
  const [rowNote, setRowNote] = useState<Record<string, string>>({});
  const toStack = async (c: RobotStory, title?: string) => {
    setRowNote((r) => ({ ...r, [c.story_key]: "ставим…" }));
    try {
      await api.robotQueue({
        action: "add", story_key: c.story_key, run_id: (c as Row).run_id ?? run.id, title: title ?? c.title_ru, topic: c.topic, final: c.final,
        url: c.sources[0]?.url,
      });
      setRowNote((r) => ({ ...r, [c.story_key]: "" }));
      await act(async () => {});
    } catch (e) {
      setRowNote((r) => ({ ...r, [c.story_key]: (e as Error).message }));
    }
  };
  const judge = (story: string, verdict: "yes" | "no", runId?: string) =>
    act(() => api.robotInbox({ action: "judge", run_id: runId ?? run.id, story_key: story, verdict }));
  const written = new Set([...run.news.map((n) => n.candidate.story_key),
    ...allRows.filter((c) => c.written).map((c) => c.story_key)]);
  const counts = rows.reduce<Record<string, number>>((m, c) => ({ ...m, [c.topic ?? ""]: (m[c.topic ?? ""] ?? 0) + 1 }), {});
  const shownRows = topic ? rows.filter((c) => c.topic === topic) : rows;
  return (
    <>
      <Orders ov={ov} act={act} />

      <h2>Переведено заранее</h2>
      <p className="hint">Лучшие истории прогона робот переводит сам; остальные — после «В стек». Готовая новость открывается по заголовку в таблице.</p>
      {run.news.length === 0 && <p className="hint">{run.running ? "Тексты появятся по мере готовности." : "В этом прогоне текстов нет."}</p>}
      {run.news.map((s) => {
        const n = s.news ?? {}, img = n.images?.[0];
        const cand = run.candidates.find((c) => c.story_key === s.candidate.story_key);
        return (
          <details className="block" key={s.candidate.story_key}>
            <summary><b>{n.title ?? s.candidate.story_key}</b> <span className="hint">· оценка {s.candidate.final}
              {s.issues.length ? ` · замечаний ${s.issues.length}` : ""}</span></summary>
            {img && <figure><img src={img.url} alt="" loading="lazy" style={{ maxWidth: "100%" }} /><figcaption className="hint">{img.caption}</figcaption></figure>}
            <p><b>{n.lead}</b></p>
            {n.paragraphs?.map((p, i) => <p key={i}>{p}</p>)}
            {n.more && <p className="hint">{n.more}</p>}
            {[...s.issues, ...s.warnings].map((x, i) => <p className="error" key={i}>{x}</p>)}
            <p>{inStack.has(s.candidate.story_key) ? <span className="hint">в стеке</span>
              : cand && <button type="button" onClick={() => toStack(cand, n.title)}>В стек</button>}</p>
          </details>
        );
      })}
      <h2>Отбор и ранжирование</h2>
      <p className="hint">
        Истории всех прогонов за две недели, одна строка на историю. Просмотренные — с вашим «Да / Нет» или в стеке —
        скрыты; их видно во вкладке «Просмотренные».
      </p>
      <div className="robot-tabs filters">
        {([["new", "Непросмотренные"], ["seen", "Просмотренные"], ["all", "Все"]] as const).map(([code, title]) => (
          <a key={code} href="#" className={view === code ? "active" : undefined}
            onClick={(e) => { e.preventDefault(); setView(code); }}>
            {title} ({allRows.filter((c) => code === "all" || (code === "new" ? !reviewed(c) : reviewed(c))).length})
          </a>
        ))}
      </div>
      <div className="robot-tabs filters">
        {[["", "Все"], ["architecture", "Архитектура"], ["neurogeneration", "Нейрогенерация"], ["software", "ПО"]].map(([code, title]) => (
          <a key={code} href="#" className={topic === code ? "active" : undefined}
            onClick={(e) => { e.preventDefault(); setTopic(code); }}>
            {title} ({code ? counts[code] ?? 0 : rows.length})
          </a>
        ))}
      </div>
      {rows.length === 0 ? <p className="hint">{run.running ? "Отбор ещё не начался." : "Отбора в этом прогоне не было."}</p> : (
        <table className="grid-table">
          <thead><tr><th>#</th><th>Оценка</th><th>Тема</th><th>Новость</th><th>Почему</th><th>Выпустил бы?</th><th>Стек</th><th>Публикация</th></tr></thead>
          <tbody>
            {shownRows.map((c, i) => {
              const v = ov.judged[c.story_key] ?? pendingVerdict[c.story_key];
              return (
                <tr key={c.story_key || i}>
                  <td>{i + 1}</td>
                  <td><b>{c.final}</b>{!c.partial && <><br /><span className="hint">LLM {c.interest}</span></>}</td>
                  <td>{TOPIC[c.topic ?? ""] ?? c.topic}<br /><span className="hint">{KIND[c.kind ?? ""] ?? c.kind}{c.competition ? " · конкурс" : ""}</span></td>
                  <td>
                    {ov.prepared[c.story_key]?.status === "готово" && inStack.has(c.story_key)
                      ? <Link to={`/robot/preview/${c.story_key}`}><b>{ov.prepared[c.story_key].title || c.title_ru}</b></Link>
                      : c.title_ru}
                    {written.has(c.story_key) && <span className="hint"> · переведено</span>}<br />
                    {c.sources.map((s) => <a className="hint" key={s.url} href={s.url} target="_blank" rel="noreferrer">{s.source} </a>)}
                  </td>
                  <td className="hint">{c.reason}</td>
                  <td>{!c.partial && <>
                    <button type="button" className={v === "yes" ? undefined : "ghost"} onClick={() => judge(c.story_key, "yes", (c as Row).run_id)}>Да</button>{" "}
                    <button type="button" className={v === "no" ? undefined : "ghost"} onClick={() => judge(c.story_key, "no", (c as Row).run_id)}>Нет</button>
                  </>}</td>
                  <td>{!c.partial && (inStack.has(c.story_key) ? <span className="hint">в стеке</span>
                    : <button type="button" className="ghost" onClick={() => toStack(c)}>В стек</button>)}
                    {rowNote[c.story_key] && <div className="error">{rowNote[c.story_key]}</div>}</td>
                  <td><Publication storyKey={c.story_key} ov={ov} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}

/**
 * «Заказать новость» (Р-104): тема, раздел, ссылки и текст, указание — робот пишет новость-обзор
 * по ссылкам редактора; дальше обычный путь: превью, перегенерация, «В стек», слот, публикация.
 */
function Orders({ ov, act }: { ov: RobotOverview; act: Act }) {
  const [form, setForm] = useState({ topic: "", section: "neurogeneration", input: "", note: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const inStack = new Set(ov.queue.items.map((i) => i.story_key));
  const done = Object.entries(ov.prepared).filter(([, p]) => p.order).sort((a, b) =>
    String(b[1].order?.at ?? "").localeCompare(String(a[1].order?.at ?? "")));
  const send = async () => {
    if (!form.topic.trim()) return setMsg("Нужна тема: о чём новость");
    if (!/https?:\/\/\S+/.test(form.input)) return setMsg("Нужна хотя бы одна ссылка — робот пишет по источникам");
    try {
      await api.robotOrder(form);
      setMsg("Заказ передан роботу: он возьмёт его в течение минуты, перевод занимает около минуты.");
      setForm({ ...form, topic: "", input: "", note: "" });
      await act(async () => {});
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const toStack = (key: string, title?: string, section?: string) => act(() => api.robotQueue({
    action: "add", story_key: key, run_id: "order", title, topic: section, final: 100,
  }), "Новость поставлена в ближайший свободный слот.");
  return (
    <>
      <h2>Заказать новость</h2>
      <div className="block">
        <p className="hint">
          О чём робот не писал — сервис, программа, событие. Робот не ищет в интернете: он откроет ваши ссылки
          (первая — главный источник), возьмёт оттуда факты и фото и напишет новость по тем же правилам.
        </p>
        <div className="row">
          <input style={{ flex: 3 }} placeholder="Тема: сервис FORMAS.AI для архитекторов" value={form.topic}
            onChange={(e) => setForm({ ...form, topic: e.target.value })} />
          <select value={form.section} onChange={(e) => setForm({ ...form, section: e.target.value })}>
            <option value="architecture">Архитектура</option>
            <option value="neurogeneration">Нейрогенерация</option>
            <option value="software">Архитектурное ПО</option>
          </select>
        </div>
        <textarea rows={4} style={{ width: "100%" }} value={form.input} onChange={(e) => setForm({ ...form, input: e.target.value })}
          placeholder={"https://formas.ai — ссылки, каждая с новой строки\nили текст: факты, цены, что важно"} />
        <input style={{ width: "100%" }} placeholder="Что важно в новости (необязательно)" value={form.note}
          onChange={(e) => setForm({ ...form, note: e.target.value })} />
        <p><button type="button" onClick={send}>Заказать</button> {msg && <span className="hint">{msg}</span>}</p>
      </div>
      {((ov.orders_pending ?? []).length > 0 || done.length > 0) && (
        <table className="grid-table">
          <thead><tr><th>Заказ</th><th>Раздел</th><th>Состояние</th><th>Стек</th><th>Публикация</th></tr></thead>
          <tbody>
            {(ov.orders_pending ?? []).map((o) => (
              <tr key={o.story_key}><td>{o.topic}</td><td>{TOPIC[o.section] ?? o.section}</td>
                <td className="hint">ждёт робота</td><td /><td /></tr>
            ))}
            {done.map(([key, p]) => (
              <tr key={key}>
                <td>{p.status === "готово" ? <Link to={`/robot/preview/${key}`}><b>{p.title || p.order?.topic}</b></Link> : p.order?.topic}
                  <br /><span className="hint">{p.order?.topic}{p.order?.by ? ` · ${p.order.by}` : ""}</span></td>
                <td>{TOPIC[p.order?.section ?? ""] ?? p.order?.section}</td>
                <td className={p.status === "ошибка" ? "error" : "hint"}>{p.status === "ошибка" ? `ошибка: ${p.error}` : p.status}</td>
                <td>{p.status === "готово" && (inStack.has(key) ? <span className="hint">в стеке</span>
                  : <button type="button" className="ghost" onClick={() => toStack(key, p.title, p.order?.section)}>В стек</button>)}</td>
                <td><Publication storyKey={key} ov={ov} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

/**
 * Колонка «Публикация» (Р-97): после «В стек» робот переводит и готовит новость;
 * когда готово — слот выхода, а заголовок ведёт к превью.
 */
function Publication({ storyKey, ov, slot = true }: { storyKey: string; ov: RobotOverview; slot?: boolean }) {
  const q = ov.queue.items.find((i) => i.story_key === storyKey);
  if (!q) return null;
  const p = ov.prepared[storyKey];
  const day = new Date(`${q.date}T12:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  const place = slot ? `${day}, ${q.time} · ` : "";
  if (!p || p.status === "новый" || p.status === "ждёт") return <span className="hint">{place}ждёт перевода</span>;
  if (p.status === "переводится") return <span className="hint">{place}переводится…</span>;
  if (p.status === "переделывается") return <span className="hint">{place}переделывается…</span>;
  if (p.status === "ошибка") return <span className="error">{place}ошибка: {p.error}</span>;
  const issues = p.issues ?? [];
  return (
    <span className="robot-pub">
      {slot && <span className="hint">{place.replace(/ · $/, "")}</span>}
      <Link to={`/robot/preview/${storyKey}`}>готово — превью</Link>
      {issues.length > 0 && (
        <span className="robot-issues" tabIndex={0}>
          замечаний: {issues.length}
          <span className="robot-issues-pop" role="tooltip">
            {issues.map((x, i) => <span key={i}>{x}</span>)}
            <Link to={`/robot/preview/${storyKey}`}>Перегенерировать →</Link>
          </span>
        </span>
      )}
    </span>
  );
}

const COVER_MODELS: [string, string][] = [
  ["google/gemini-3-pro-image-preview", "Gemini 3 Pro Image (Nano Banana Pro)"],
  ["google/gemini-3.1-flash-image", "Gemini 3.1 Flash Image — быстрее"],
  ["black-forest-labs/flux.2-pro", "FLUX.2 Pro"],
  ["openai/gpt-image-1.5", "GPT Image 1.5"],
];

/** Картинка варианта обложки — маршрут только для su, грузим с токеном. */
function CoverImage({ file }: { file: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    api.robotCoverImage(file).then((u) => { url = u; setSrc(u); }).catch(() => setSrc(null));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [file]);
  return src ? <img src={src} alt="" style={{ width: "100%", display: "block" }} /> : <p className="hint">загружаем…</p>;
}

/**
 * «Создать обложку» (Р-107): LLM готовит промпт в стиле графики Анненкова к «Двенадцати» Блока,
 * редактор правит, генерация через Polza.AI, «Поставить обложкой» — первой иллюстрацией новости.
 * Для новостей о зданиях обложки не генерируются — там свои снимки.
 */
function CoverBlock({ storyKey, rec, onSent }: { storyKey: string; rec: RobotPreparedFull; onSent: () => void }) {
  const cover = rec.cover ?? {};
  const [promptText, setPromptText] = useState(cover.prompt ?? "");
  const [model, setModel] = useState(cover.model ?? COVER_MODELS[0][0]);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (cover.prompt) setPromptText(cover.prompt); }, [cover.prompt]);
  // Работа идёт, пока запрос в очереди у робота или робот над ним работает; состояние — с сервера,
  // поэтому переживает обновление страницы (2026-10-05).
  const working = cover.status === "промпт готовится" || cover.status === "генерируется";
  const busy = Boolean(cover.pending) || working;
  const since = cover.pending?.at ?? (working ? cover.started_at : undefined);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);
  const elapsed = since ? Math.max(0, Math.round((Date.now() - new Date(since).getTime()) / 1000)) : 0;
  void tick;
  const phase = cover.pending
    ? (cover.pending.action === "generate" ? "в очереди у робота — затем модель рисует" : cover.pending.action === "apply"
      ? "в очереди у робота — ставим обложкой" : "в очереди у робота — затем LLM пишет промпт")
    : cover.status === "генерируется" ? "модель рисует" : "LLM пишет промпт";
  const expected = cover.pending?.action === "generate" || cover.status === "генерируется" ? "обычно 1–3 минуты" : "обычно 1–2 минуты";
  const send = async (body: Parameters<typeof api.robotCover>[0], _note: string) => {
    try {
      await api.robotCover(body);
      setMsg(null);
      onSent();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  return (
    <div className="block">
      <h3>Обложка</h3>
      <p className="hint">
        Для новостей без своих снимков — конференция, вебинар, сервис, событие. Стиль — графика Юрия Анненкова
        к «Двенадцати» Блока (1918): чёрная тушь, сломанные плоскости, штриховка. Подпись: «Иллюстрация создана ИИ для Вх²».
      </p>
      {busy && (
        <p className="notice">
          {phase} · идёт {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")} ({expected}) — страница обновится сама
        </p>
      )}
      {!busy && cover.status && <p className={cover.status === "ошибка" ? "error" : "hint"}>
        Состояние: {cover.status}{cover.error ? ` — ${cover.error}` : ""}</p>}
      {!cover.prompt && !busy && (
        <button type="button" onClick={() => send({ story_key: storyKey, action: "draft" },
          "LLM готовит промпт — он появится здесь в течение минуты.")}>Создать обложку</button>
      )}
      {cover.prompt && (
        <>
          {cover.idea_ru && <p><b>Идея:</b> {cover.idea_ru}</p>}
          <label className="hint">Промпт для модели (можно править)</label>
          <textarea rows={6} style={{ width: "100%" }} value={promptText} onChange={(e) => setPromptText(e.target.value)} />
          <div className="row">
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {COVER_MODELS.map(([code, title]) => <option key={code} value={code}>{title}</option>)}
            </select>
            <button type="button" disabled={busy} onClick={() => send({ story_key: storyKey, action: "generate", prompt: promptText, model },
              "Отправлено в генерацию — вариант появится здесь через минуту-две.")}>
              {(cover.variants ?? []).length ? "Ещё вариант" : "Сгенерировать"}
            </button>
            <button type="button" className="ghost" disabled={busy} onClick={() => send({ story_key: storyKey, action: "draft" },
              "LLM готовит новый промпт.")}>Новый промпт</button>
          </div>
        </>
      )}
      {(cover.variants ?? []).length > 0 && (
        <div className="robot-covers">
          {(cover.variants ?? []).slice().reverse().map((v) => (
            <figure key={v.file} className={cover.chosen === v.file ? "chosen" : undefined}>
              <CoverImage file={v.file} />
              <figcaption className="hint">
                {v.model.split("/").pop()} · {new Date(v.at).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}
                {cover.chosen === v.file
                  ? <> · <b>обложка{cover.applied_at ? "" : " (встанет при создании записи)"}</b></>
                  : <> · <button type="button" className="ghost" onClick={() => send({ story_key: storyKey, action: "apply", file: v.file },
                    "Ставим обложкой — в течение минуты она станет первой иллюстрацией новости.")}>Поставить обложкой</button></>}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      {msg && <p className="hint">{msg}</p>}
    </div>
  );
}

/** Превью подготовленной новости — так, как она выйдет на сайте. */
function Preview({ storyKey, ov }: { storyKey: string; ov: RobotOverview }) {
  const [rec, setRec] = useState<RobotPreparedFull | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [note, setNote] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const status = ov.prepared[storyKey]?.status;
  // Перезагружаем превью, когда робот закончил переделку (статус меняется в сводке раздела).
  useEffect(() => {
    api.robotPrepared(storyKey).then(setRec).catch((e) => setErr((e as Error).message));
  }, [storyKey, ov.prepared[storyKey]?.ready_at, ov.prepared[storyKey]?.cover?.status,
    ov.prepared[storyKey]?.cover?.pending?.at]);
  const regenerate = async () => {
    setSent("отправляем…");
    try {
      await api.robotRegenerate({ story_key: storyKey, input, note });
      setSent("Запрос передан роботу: он возьмёт его в течение минуты, превью обновится само.");
      setInput("");
      setNote("");
    } catch (e) {
      setSent((e as Error).message);
    }
  };
  const q = ov.queue.items.find((i) => i.story_key === storyKey);
  if (err) return <p className="error">{err}</p>;
  if (!rec) return <p className="notice">Загружаем превью…</p>;
  const n = rec.story?.news ?? {};
  const sources = rec.story?.candidate?.sources ?? [];
  const issues = [...(rec.story?.issues ?? []), ...(rec.story?.warnings ?? [])];
  return (
    <article className="robot-preview">
      <p className="hint">
        <Link to="/robot/news">← к отбору</Link>
        {q && ` · выход ${new Date(`${q.date}T12:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}, ${q.time}`}
        {rec.ready_at && ` · подготовлено ${new Date(rec.ready_at).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}`}
      </p>
      <h2>{n.title}</h2>
      {n.images?.[0] && (
        <figure><img src={n.images[0].url} alt="" style={{ maxWidth: "100%" }} /><figcaption className="hint">{n.images[0].caption}</figcaption></figure>
      )}
      <p><b>{n.lead}</b></p>
      {n.paragraphs?.map((p, i) => <p key={i}>{p}</p>)}
      {n.images?.slice(1).map((im) => (
        <figure key={im.url}><img src={im.url} alt="" style={{ maxWidth: "100%" }} loading="lazy" /><figcaption className="hint">{im.caption}</figcaption></figure>
      ))}
      {n.more && <p className="hint">{n.more}</p>}
      <p className="hint">
        Первоисточник: {sources.map((src, i) => (
          <span key={src.url}>{i ? " · " : ""}<a href={src.url} target="_blank" rel="noreferrer">{src.source}{src.date ? `, ${src.date}` : ""}</a></span>
        ))}
        {(n.sources ?? []).filter((x) => x.url && !sources.some((src) => src.url === x.url)).map((x) => (
          <span key={x.url}> · <a href={x.url} target="_blank" rel="noreferrer">{x.title || x.url}</a></span>
        ))}
      </p>
      {n.mentions?.length ? <p className="hint">Упоминания: {n.mentions.map((m) => m.name).join(" · ")}</p> : null}
      {issues.length > 0 && (
        <div className="block">
          <h3>Замечания проверки</h3>
          {issues.map((x, i) => <p className="error" key={i}>{x}</p>)}
        </div>
      )}
      <CoverBlock storyKey={storyKey} rec={rec} onSent={() => api.robotPrepared(storyKey).then(setRec).catch(() => {})} />
      <div className="block">
        <h3>Переделать</h3>
        {status === "переделывается" || status === "переводится" ? (
          <p className="notice">Робот переделывает новость…</p>
        ) : (
          <>
            <p className="hint">
              Робот передаст LLM замечания проверки и ваше указание и напишет новость заново. Ссылки (каждая с новой строки)
              он откроет как дополнительные источники текста и фото; остальной текст возьмёт как материал от редактора.
            </p>
            <label className="hint">Добавить ссылку или текст</label>
            <textarea rows={5} style={{ width: "100%" }} value={input} onChange={(e) => setInput(e.target.value)}
              placeholder={"https://… — откуда взять медиа и текст\nили сам текст: факты, подписи, уточнения"} />
            <label className="hint">Что исправить (необязательно)</label>
            <input style={{ width: "100%" }} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="Например: короче; без перечня проектов; фото с фасада" />
            <p><button type="button" onClick={regenerate}>Перегенерировать с учётом замечаний</button></p>
          </>
        )}
        {sent && <p className="hint">{sent}</p>}
        {rec.origin && <p className="hint">Эта версия: {rec.origin}{rec.ready_at ? `, ${new Date(rec.ready_at).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}` : ""}.</p>}
      </div>
    </article>
  );
}

function Stack({ ov, act }: { ov: RobotOverview; act: Act }) {
  const q = ov.queue;
  const bySlot = Object.fromEntries(q.items.map((i) => [`${i.date} ${i.time}`, i]));
  const options = q.days.flatMap((d) => q.times.map((t) => `${d} ${t}`));
  const dayName = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "long" });
  const shown = q.days.filter((d, i) => i < 7 || q.items.some((it) => it.date === d));
  const later = q.items.filter((i) => !q.days.includes(i.date));
  // Перетаскивание — как у изображений записи (AttachedMedia): ручка «⠿», слот подсвечивается.
  // Сброс на занятый слот меняет новости местами — это делает сервер (POST /queue, move).
  const [dragged, setDragged] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const drop = (slot: string) => {
    const key = dragged;
    setDragged(null);
    setOver(null);
    if (!key || bySlot[slot]?.story_key === key) return;
    const [date, time] = slot.split(" ");
    act(() => api.robotQueue({ action: "move", story_key: key, date, time }));
  };
  return (
    <>
      <p className="hint">
        Слоты выхода — {q.times.join(", ")} по Москве. «В стек» в разделе «Новости» ставит историю в ближайший свободный слот;
        здесь её можно перетащить за «⠿» в другой слот (занятый слот меняется местами), выбрать слот из списка или снять. Выпускать по стеку будет планировщик — пока это план.
      </p>
      <div className="robot-days">
        {shown.map((d) => (
          <div className="block" key={d}>
            <h3>{dayName(d)}</h3>
            {q.times.map((t) => {
              const slot = `${d} ${t}`;
              const it = bySlot[slot];
              return (
                <div
                  className={`robot-slot${over === slot ? " drop-target" : ""}${it && dragged === it.story_key ? " dragging" : ""}`}
                  key={t}
                  onDragOver={(event) => {
                    if (dragged === null) return;
                    event.preventDefault();
                    setOver(slot);
                  }}
                  onDragLeave={() => setOver((current) => (current === slot ? null : current))}
                  onDrop={(event) => {
                    event.preventDefault();
                    drop(slot);
                  }}
                >
                  <span className="hint">{t}</span>
                  {it ? (
                    <div className="robot-slot-item">
                      <span
                        className="drag-handle"
                        title="Перетащите в другой слот; на занятый — поменяются местами"
                        draggable
                        onDragStart={(event) => {
                          setDragged(it.story_key);
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", it.story_key);
                        }}
                        onDragEnd={() => {
                          setDragged(null);
                          setOver(null);
                        }}
                      >
                        ⠿
                      </span>
                      <div>{ov.prepared[it.story_key]?.status === "готово"
                        ? <Link to={`/robot/preview/${it.story_key}`}>{ov.prepared[it.story_key].title || it.title}</Link> : it.title}</div>
                      <div><Publication storyKey={it.story_key} ov={ov} slot={false} />
                        {ov.prepared[it.story_key]?.status === "готово" && <> · <Link to={`/robot/preview/${it.story_key}`}>обложка</Link></>}</div>
                      <div className="hint">{TOPIC[it.topic ?? ""] ?? ""}{it.final != null ? ` · оценка ${it.final}` : ""}{it.by ? ` · ${it.by}` : ""}</div>
                      <select value={`${d} ${t}`} onChange={(e) => {
                        const [date, time] = e.target.value.split(" ");
                        act(() => api.robotQueue({ action: "move", story_key: it.story_key, date, time }));
                      }}>
                        {options.map((o) => <option key={o}>{o}</option>)}
                      </select>{" "}
                      <button type="button" className="ghost" onClick={() => act(() => api.robotQueue({ action: "remove", story_key: it.story_key }))}>Снять</button>
                    </div>
                  ) : <div className="hint">свободно</div>}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {later.length > 0 && <p className="hint">Позже: {later.map((i) => `${i.date} ${i.time} — ${i.title}`).join("; ")}</p>}
    </>
  );
}

function Sites({ ov, run }: { ov: RobotOverview; run: RobotRunView | null }) {
  const thisRun = Object.fromEntries((run?.feeds ?? []).map((f) => [f.id, f]));
  const groups: [string, string][] = [["architecture", "Архитектура"], ["neurogeneration", "Нейрогенерация"], ["software", "Архитектурное ПО"]];
  const on = ov.sources.filter((s) => s.enabled).length;
  if (!ov.sources.length) return <p className="notice">Робот ещё не прислал список — он появится после первого прогона на сервере.</p>;
  return (
    <>
      <p className="hint">Включено {on} из {ov.sources.length}. Список — news-robot/sources.yaml и сайты, включённые из рекомендаций.</p>
      {groups.map(([code, title]) => {
        const g = ov.sources.filter((s) => (s.topics ?? [])[0] === code);
        return (
          <details key={code} open={code === "architecture"}>
            <summary><b>{title}</b> <span className="hint">{g.filter((s) => s.enabled).length} из {g.length}</span></summary>
            <table className="grid-table">
              <thead><tr><th>Сайт</th><th>Как читаем</th><th>Доверие</th><th>Этот прогон</th><th>Свежий</th><th>Состояние</th></tr></thead>
              <tbody>{g.map((s) => <SiteRow key={s.id} s={s} f={thisRun[s.id]} running={!!run?.running} />)}</tbody>
            </table>
          </details>
        );
      })}
    </>
  );
}

function SiteRow({ s, f, running }: { s: RobotSourceRow; f?: RobotRunView["feeds"][number]; running: boolean }) {
  const list = Array.isArray(s.list_url) ? s.list_url[0] : s.list_url;
  return (
    <tr style={s.enabled ? undefined : { opacity: 0.6 }}>
      <td><a href={s.site ?? s.feed ?? list ?? "#"} target="_blank" rel="noreferrer">{s.title}</a>
        <span className="hint"> {s.lang}{s.vendor ? " · производитель" : ""}{s.origin === "редактор" ? " · добавлен вами" : ""}</span></td>
      <td className="hint">{s.feed ? <a href={s.feed} target="_blank" rel="noreferrer">лента</a> : list ? "страница-список" : "—"}
        {Object.keys(s.filters ?? {}).length ? " · фильтр" : ""}</td>
      <td>{s.trust ?? "—"}</td>
      <td>{!s.enabled ? "—" : f ? (f.status.startsWith("ошибка") ? <span className="error">{f.status}</span> : <>{f.items} · новых <b>{f.new}</b></>)
        : running ? <span className="hint">ждёт</span> : "—"}</td>
      <td className="hint">{(s.last_item ?? "").slice(0, 10) || "—"}</td>
      <td className={s.fail_count ? "error" : "hint"}>
        {!s.enabled ? `выключен${s.note ? `: ${s.note}` : ""}` : s.fail_count ? `ошибка ×${s.fail_count}: ${s.last_error ?? ""}`
          : s.last_checked ? `прочитан ${when(s.last_checked)}` : "ещё не обходили"}
      </td>
    </tr>
  );
}

function Recs({ ov, act }: { ov: RobotOverview; act: Act }) {
  const [proposal, setProposal] = useState({ url: "", note: "" });
  const [err, setErr] = useState<string | null>(null);
  const queued = new Set(ov.pending.filter((p) => p.action === "decide").map((p) => p.domain));
  const proposed = ov.pending.filter((p) => p.action === "propose");
  const open = ov.candidates.filter((c) => OPEN.has(c.status));
  const decided = ov.candidates.filter((c) => !OPEN.has(c.status));
  const decide = (domain: string, decision: "include" | "once" | "reject") =>
    act(() => api.robotInbox({ action: "decide", domain, decision }), `Решение по ${domain} передано роботу — применится при следующем запуске.`);
  return (
    <>
      <p className="hint">
        Робот находит издания по ссылкам статей (первоисточники и другие издания), проверяет у них ленту, robots.txt
        и частоту, LLM оценивает, подходит ли сайт. Включаете вы.
      </p>
      {open.length === 0 && <p className="notice">Рекомендаций, ждущих решения, нет.</p>}
      {open.map((c) => <RecCard key={c.domain} c={c} queued={queued.has(c.domain)} decide={decide} />)}
      <div className="block">
        <h3>Предложить сайт</h3>
        <div className="row">
          <input style={{ flex: 2 }} placeholder="https://archi.ru" value={proposal.url}
            onChange={(e) => { setProposal({ ...proposal, url: e.target.value }); setErr(null); }} />
          <input style={{ flex: 2 }} placeholder="Почему: где увидели, что там ценного" value={proposal.note}
            onChange={(e) => setProposal({ ...proposal, note: e.target.value })} />
          <button type="button" onClick={() => {
            if (!/^https?:\/\/\S+\.\S+/.test(proposal.url.trim())) return setErr("Нужен адрес сайта, например https://archi.ru");
            act(() => api.robotInbox({ action: "propose", url: proposal.url.trim(), note: proposal.note || undefined }),
              "Сайт передан роботу: он найдёт ленту, проверит robots.txt и оценит издание при следующем запуске.")
              .then(() => setProposal({ url: "", note: "" }));
          }}>Проверить</button>
        </div>
        {err && <p className="error">{err}</p>}
        {proposed.length > 0 && <p className="hint">Ждут проверки роботом: {proposed.map((p) => p.url).join(", ")}</p>}
      </div>
      {decided.length > 0 && (
        <details>
          <summary>Решённые ({decided.length})</summary>
          <table className="grid-table">
            <thead><tr><th>Сайт</th><th>Решение</th><th>Когда</th><th>Пояснение</th></tr></thead>
            <tbody>{decided.map((c) => (
              <tr key={c.domain}><td>{c.domain}</td><td>{c.status}</td><td>{when(c.decided_at)}</td><td>{c.decision_note}</td></tr>
            ))}</tbody>
          </table>
        </details>
      )}
    </>
  );
}

function RecCard({ c, queued, decide }: {
  c: RobotSourceCandidate; queued: boolean; decide: (d: string, x: "include" | "once" | "reject") => void;
}) {
  const p = c.probe, a = c.assessment;
  return (
    <div className="block">
      <div className="row">
        <h3 style={{ flex: 1 }}>{p?.title || c.domain} <span className="hint">{c.domain}</span></h3>
        {queued ? <span className="hint">решение в очереди</span> : <>
          <button type="button" onClick={() => decide(c.domain, "include")}>Включить</button>
          <button type="button" className="ghost" onClick={() => decide(c.domain, "once")}>Разово</button>
          <button type="button" className="ghost" onClick={() => decide(c.domain, "reject")}>Отклонить</button>
        </>}
      </div>
      <p className="hint">
        {c.proposed_by === "editor" ? `Предложили вы${c.note ? `: ${c.note}` : ""}`
          : `Ссылок из статей: ${c.count ?? 0} (${Object.entries(c.kinds ?? {}).map(([k, v]) => `${LINK_KIND[k] ?? k} ${v}`).join(", ")})`}
        {p ? ` · лента: ${p.feed ? "есть" : "нет"} · ${p.per_week ?? 0} в неделю · язык ${p.lang ?? "?"}${p.note ? ` · ${p.note}` : ""}` : " · робот ещё не проверял"}
      </p>
      {a && <p>LLM: <b>{RECOMMEND[a.recommend ?? ""] ?? a.recommend}</b>
        {a.topics?.length ? ` · ${a.topics.map((t) => TOPIC[t] ?? t).join(", ")}` : ""}
        {a.trust !== undefined ? ` · доверие ${a.trust}` : ""} — {a.reason}</p>}
      {p?.samples?.length ? <ul className="hint">{p.samples.slice(0, 4).map((t) => <li key={t}>{t}</li>)}</ul> : null}
      {c.examples?.slice(0, 2).map((x) => (
        <p className="hint" key={x.url}>Ссылка: <a href={x.url} target="_blank" rel="noreferrer">{x.about || x.url}</a></p>
      ))}
    </div>
  );
}

function Learning({ learned }: { learned: RobotLearned | null }) {
  const a = learned?.adjustments;
  if (!a) {
    return (
      <p className="hint">
        Отмечайте истории в разделе «Новости»: «Да» или «Нет». Когда наберётся 15 решений, робот пересчитает поправки
        ранжирования и через LLM обновит описание вашего вкуса — оно заменит общее описание в промпте отбора, если на
        отложенных решениях совпадёт с вами не хуже прежнего.
      </p>
    );
  }
  const sign = (n: number) => (n > 0 ? `+${n}` : String(n));
  return (
    <>
      <p className="hint">
        Решений: {a.n} · выбрано в среднем {Math.round(a.base_rate * 100)}%
        {a.per_extra_source != null && ` · каждое следующее издание той же истории: ${sign(a.per_extra_source)} к оценке`}
      </p>
      {Object.keys(a.kind).length > 0 && (
        <p>Поправки по виду материала: {Object.entries(a.kind).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${KIND[k] ?? k} ${sign(v)}`).join(" · ")}</p>
      )}
      {learned?.profile_text && (
        <div className="block">
          <h3>Ваш вкус — так его видит LLM</h3>
          <p style={{ whiteSpace: "pre-line" }}>{learned.profile_text}</p>
        </div>
      )}
    </>
  );
}

/** Журнал прогона: пока прогон идёт, дочитывается каждые три секунды. */
function LogView({ runId, live }: { runId: string; live: boolean }) {
  const [lines, setLines] = useState<RobotLogLine[]>([]);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const box = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let next = 0;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pull = async () => {
      try {
        const r = await api.robotLog(runId, next);
        if (!alive) return;
        next = r.next;
        if (r.items.length) setLines((old) => [...old, ...r.items].slice(-2000));
        if (r.running || r.items.length === 500) timer = setTimeout(pull, r.items.length === 500 ? 0 : 3000);
      } catch {
        if (alive && live) timer = setTimeout(pull, 10000);
      }
    };
    pull();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [runId, live]);

  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [lines]);

  const shown = onlyProblems ? lines.filter((l) => l.level === "warn" || l.level === "error") : lines;
  return (
    <>
      <label className="hint">
        <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> только предупреждения и ошибки
      </label>
      <pre ref={box} className="robot-log">
        {shown.slice(-400).map((l, i) => {
          const { ts, level, stage, msg, run_id: _run, ...rest } = l;
          const extra = Object.entries(rest).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join(" ");
          return (
            <div key={i} className={level === "error" ? "error" : undefined} style={level === "warn" ? { color: "#8a5a00" } : undefined}>
              {(ts ?? "").slice(11, 19)} {STAGE[stage ?? ""] ?? stage}: {msg} <span className="hint">{extra}</span>
            </div>
          );
        })}
      </pre>
    </>
  );
}
