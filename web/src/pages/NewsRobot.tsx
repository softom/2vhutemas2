/**
 * Робот новостей — страница работы (только `su`).
 *
 * Робот — отдельный процесс на сервере (news-robot/). Здесь видно, как
 * прошли его прогоны: какие ленты прочитаны, что отобрано, какие новости
 * написаны и на какие издания ссылаются статьи. Главное действие —
 * решение по кандидатам в источники: робот находит их по ссылкам статей,
 * редактор предлагает сам, а включает в обход только человек. Решение
 * уходит роботу в ящик и применяется при следующем запуске.
 */
import { useEffect, useState } from "react";
import { api, type RobotRun, type RobotRunRow, type RobotSourceCandidate } from "../api";

const TOPIC: Record<string, string> = { architecture: "Архитектура", neurogeneration: "Нейрогенерация", software: "ПО" };
const RECOMMEND: Record<string, string> = { include: "включить", once: "разово", skip: "не нужен" };
const LINK_KIND: Record<string, string> = { primary: "первоисточник", news_portal: "издание", research: "исследование" };
const OPEN = new Set(["новый", "ждёт решения"]);

function when(iso?: string | null) {
  return iso ? new Date(iso).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }) : "—";
}

export function NewsRobot({ allowed }: { allowed: boolean }) {
  const [runs, setRuns] = useState<RobotRunRow[]>([]);
  const [connected, setConnected] = useState(true);
  const [run, setRun] = useState<RobotRun | null>(null);
  const [candidates, setCandidates] = useState<RobotSourceCandidate[]>([]);
  const [queued, setQueued] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [proposal, setProposal] = useState({ url: "", note: "" });
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const loadCandidates = () =>
    api.robotCandidates().then((r) => {
      setCandidates(r.items ?? []);
      setQueued(new Set((r.pending ?? []).map((p) => p.domain ?? p.url ?? "")));
    }).catch((e) => setError((e as Error).message));

  useEffect(() => {
    if (!allowed) return;
    api.robotRuns().then((r) => {
      setRuns(r.items ?? []);
      setConnected(r.connected);
      const last = (r.items ?? []).find((x) => x.counts);
      if (last) api.robotRun(last.id).then(setRun).catch((e) => setError((e as Error).message));
    }).catch((e) => setError((e as Error).message));
    loadCandidates();
  }, [allowed]);

  if (!allowed) return <p className="error">Страница робота доступна только суперпользователю.</p>;

  const decide = async (domain: string, decision: "include" | "once" | "reject") => {
    setError(null);
    try {
      await api.robotInbox({ action: "decide", domain, decision, note: notes[domain] || undefined });
      setStatus(`Решение по ${domain} передано роботу — применится при следующем запуске.`);
      await loadCandidates();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const propose = async () => {
    setError(null);
    if (!/^https?:\/\/\S+\.\S+/.test(proposal.url.trim())) {
      setError("Нужен адрес сайта, например https://archi.ru");
      return;
    }
    try {
      await api.robotInbox({ action: "propose", url: proposal.url.trim(), note: proposal.note || undefined });
      setStatus("Сайт передан роботу: он найдёт ленту, проверит robots.txt и оценит издание при следующем запуске.");
      setProposal({ url: "", note: "" });
      await loadCandidates();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const open = candidates.filter((c) => OPEN.has(c.status));
  const decided = candidates.filter((c) => !OPEN.has(c.status));

  return (
    <section>
      <h1>Робот новостей</h1>
      <p className="sub">
        Сбор новостей из лент, отбор LLM, тексты на подтверждение и поиск новых источников.
      </p>
      {error && <p className="error">{error}</p>}
      {status && <p className="notice">{status}</p>}
      {!connected && <p className="notice">Папки робота на сервере не подключены к API — прогонов не видно.</p>}

      <h2>Источники на подтверждение</h2>
      <p className="hint">
        Робот находит издания по ссылкам статей или проверяет предложенный вами адрес: ищет ленту, смотрит
        robots.txt, считает частоту и просит LLM оценить. В обход издание включаете вы.
      </p>
      {open.length === 0 && <p className="notice">Кандидатов, ждущих решения, нет.</p>}
      {open.map((c) => (
        <div className="block" key={c.domain}>
          <div className="row">
            <h3 style={{ flex: 1 }}>
              {c.probe?.title || c.domain} <span className="hint">{c.domain}</span>
            </h3>
            {queued.has(c.domain) ? <span className="hint">решение в очереди</span> : (
              <>
                <button type="button" onClick={() => decide(c.domain, "include")}>Включить</button>
                <button type="button" className="ghost" onClick={() => decide(c.domain, "once")}>Разово</button>
                <button type="button" className="ghost" onClick={() => decide(c.domain, "reject")}>Отклонить</button>
              </>
            )}
          </div>
          <p className="hint">
            {c.proposed_by === "editor" ? `Предложил редактор${c.note ? `: ${c.note}` : ""}` :
              `Ссылок из статей: ${c.count ?? 0} (${Object.entries(c.kinds ?? {}).map(([k, v]) => `${LINK_KIND[k] ?? k} ${v}`).join(", ")})`}
            {c.probe && ` · лента: ${c.probe.feed ? "есть" : "нет"} · ${c.probe.per_week ?? 0} в неделю · язык ${c.probe.lang ?? "?"}`}
            {c.probe?.note ? ` · ${c.probe.note}` : ""}
            {c.status === "новый" ? " · робот ещё не проверял" : ""}
          </p>
          {c.assessment && (
            <p>
              LLM: <b>{RECOMMEND[c.assessment.recommend ?? ""] ?? c.assessment.recommend}</b>
              {c.assessment.topics?.length ? ` · ${c.assessment.topics.map((t) => TOPIC[t] ?? t).join(", ")}` : ""}
              {c.assessment.trust !== undefined ? ` · доверие ${c.assessment.trust}` : ""} — {c.assessment.reason}
            </p>
          )}
          {c.probe?.samples?.length ? (
            <ul className="hint">{c.probe.samples.slice(0, 4).map((t) => <li key={t}>{t}</li>)}</ul>
          ) : null}
          {c.examples?.slice(0, 2).map((x) => (
            <p className="hint" key={x.url}>Ссылка: <a href={x.url} target="_blank" rel="noreferrer">{x.about || x.url}</a></p>
          ))}
          {!queued.has(c.domain) && (
            <input
              placeholder="Пояснение к решению"
              value={notes[c.domain] ?? ""}
              onChange={(e) => setNotes({ ...notes, [c.domain]: e.target.value })}
            />
          )}
        </div>
      ))}

      <div className="block">
        <h3>Предложить сайт</h3>
        <div className="row">
          <input
            style={{ flex: 2 }}
            placeholder="https://archi.ru"
            value={proposal.url}
            onChange={(e) => setProposal({ ...proposal, url: e.target.value })}
          />
          <input
            style={{ flex: 2 }}
            placeholder="Почему: где увидели, что там ценного"
            value={proposal.note}
            onChange={(e) => setProposal({ ...proposal, note: e.target.value })}
          />
          <button type="button" onClick={propose}>Проверить</button>
        </div>
      </div>

      {decided.length > 0 && (
        <details>
          <summary>Решённые кандидаты ({decided.length})</summary>
          <table className="grid-table">
            <thead><tr><th>Сайт</th><th>Решение</th><th>Когда</th><th>Пояснение</th></tr></thead>
            <tbody>
              {decided.map((c) => (
                <tr key={c.domain}>
                  <td>{c.domain}</td><td>{c.status}</td><td>{when(c.decided_at)}</td><td>{c.decision_note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      <h2>Прогоны</h2>
      {runs.length === 0 && connected && <p className="notice">Прогонов пока не было.</p>}
      {runs.length > 0 && (
        <div className="filters">
          <select value={run?.id ?? ""} onChange={(e) => api.robotRun(e.target.value).then(setRun).catch((x) => setError((x as Error).message))}>
            {runs.map((r) => (
              <option key={r.id} value={r.id} disabled={!r.counts}>
                {when(r.finished_at)} · {r.counts ? `${r.counts.items} новых, ${r.counts.news} новостей` : r.status}
              </option>
            ))}
          </select>
        </div>
      )}
      {run && <RunView run={run} />}
    </section>
  );
}

function RunView({ run }: { run: RobotRun }) {
  const c = run.counts;
  return (
    <>
      <p className="hint">
        Материалы с {when(run.since)} · лент {c.feeds - c.feeds_failed} из {c.feeds} · новых {c.items} · отсеяно
        фильтрами {c.filtered} · историй после отбора {c.candidates} · новостей {c.news}
        {run.status !== "ok" ? ` · ${run.status}` : ""}
      </p>
      {run.llm_note && <p className="hint">{run.llm_note}</p>}

      {run.news.length > 0 && <h3>Написанные новости</h3>}
      {run.news.map((s) => (
        <div className="block" key={s.candidate.story_key}>
          {s.news?.images?.[0] && <img src={s.news.images[0].url} alt="" style={{ maxWidth: "100%" }} loading="lazy" />}
          <h3>{s.news?.title}</h3>
          <p><b>{s.news?.lead}</b></p>
          {s.news?.paragraphs?.map((p, i) => <p key={i}>{p}</p>)}
          {s.news?.student_note && <p><b>Что посмотреть студенту:</b> {s.news.student_note}</p>}
          {[...s.issues, ...s.warnings].map((x, i) => <p className="error" key={i}>{x}</p>)}
        </div>
      ))}

      {run.candidates.length > 0 && (
        <>
          <h3>Отбор — по убыванию оценки</h3>
          <table className="grid-table">
            <thead><tr><th>Оценка</th><th>Тема</th><th>Материал</th><th>Почему</th></tr></thead>
            <tbody>
              {run.candidates.map((x) => (
                <tr key={x.story_key}>
                  <td>{x.final}<br /><span className="hint">{x.interest}</span></td>
                  <td>{TOPIC[x.topic ?? ""] ?? x.topic}{x.competition ? " · конкурс" : ""}</td>
                  <td>
                    {x.title_ru}
                    <br />
                    {x.sources.map((s) => (
                      <a className="hint" key={s.url} href={s.url} target="_blank" rel="noreferrer">{s.source} </a>
                    ))}
                  </td>
                  <td className="hint">{x.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {run.link_domains.length > 0 && (
        <>
          <h3>Внешние ссылки статей</h3>
          <table className="grid-table">
            <thead><tr><th>Домен</th><th>Ссылок</th><th>Как</th></tr></thead>
            <tbody>
              {run.link_domains.map((d) => (
                <tr key={d.domain}>
                  <td>{d.domain}{d.known ? <span className="hint"> (в списке)</span> : ""}</td>
                  <td>{d.count}</td>
                  <td>{Object.entries(d.kinds).map(([k, v]) => `${LINK_KIND[k] ?? k} ${v}`).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <details>
        <summary>Ленты ({run.feeds.length})</summary>
        <table className="grid-table">
          <thead><tr><th>Источник</th><th>Состояние</th><th>В ленте</th><th>Новых</th><th>Свежий</th></tr></thead>
          <tbody>
            {run.feeds.map((f) => (
              <tr key={f.id}>
                <td><a href={f.feed} target="_blank" rel="noreferrer">{f.title}</a></td>
                <td className={f.status.startsWith("ошибка") ? "error" : undefined}>{f.status}</td>
                <td>{f.items}</td><td>{f.new}</td><td>{(f.newest ?? "").slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  );
}
