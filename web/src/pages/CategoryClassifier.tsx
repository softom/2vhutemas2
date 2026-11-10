import { useState } from "react";
import { api, type RobotOverview, type RobotRunView } from "../api";
import { NEWS_CATEGORIES, newsCategory } from "./newsCategories";
import { ClassificationResult } from "./robotBlocks";

type Act = (fn: () => Promise<unknown>, done?: string) => Promise<void>;
export function CategoryClassifier({ ov, run, act }: { ov: RobotOverview; run: RobotRunView | null; act: Act }) {
  const [category, setCategory] = useState("architecture");
  const [drafts, setDrafts] = useState<Record<string, { template: string; profile: string }>>({});
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const saved = ov.prompt_view?.category_prompts?.[category];
  const draft = drafts[category] ?? saved;
  const busy = saving || Boolean(ov.retriage_queued || ov.retriage_status?.running);
  const update = (field: "template" | "profile", value: string) => {
    if (!draft) return;
    setDrafts(old => ({ ...old, [category]: { template: draft.template, profile: draft.profile, [field]: value } }));
  };
  const submit = async (promptOnly: boolean) => {
    if (!draft) return;
    setSaving(true); setMessage("");
    try {
      await api.robotRetriage({ category, category_prompt: draft.template, category_profile: draft.profile, prompt_only: promptOnly, mode: "unjudged" });
      setMessage(promptOnly ? "Промпт этой категории передан на сохранение." : "Запрошена переоценка только непросмотренных новостей этой категории.");
      await act(async () => {});
    } catch(e) { setMessage((e as Error).message); }
    finally { setSaving(false); }
  };
  const candidates = run?.candidates.filter(c => newsCategory(c) === category) ?? [];
  return <>
    <nav className="robot-tabs filters" aria-label="Категории классификатора">
      {NEWS_CATEGORIES.map(([code, title]) => <button type="button" key={code} className={category === code ? undefined : "ghost"} aria-pressed={category === code}
        onClick={() => { setCategory(code); setMessage(""); }}>{title} ({run?.candidates.filter(c => newsCategory(c) === code).length ?? 0})</button>)}
    </nav>
    <section className="block" aria-label="Промпт выбранной категории">
      <h3>Промпт оценки: {NEWS_CATEGORIES.find(([code]) => code === category)?.[1]}</h3>
      <p className="hint">В оценку поступают только новости этой категории, её критерии и её примеры. Классификация выполняется отдельно, если категория ещё неизвестна.</p>
      {draft ? <>
        <label>Шаблон категории<textarea aria-label="Шаблон категории" rows={10} style={{ width: "100%", fontFamily: "monospace" }} value={draft.template} onChange={e => update("template", e.target.value)} /></label>
        <label>Профиль категории<textarea aria-label="Профиль категории" rows={5} style={{ width: "100%" }} value={draft.profile} onChange={e => update("profile", e.target.value)} /></label>
        <p><button disabled={busy} onClick={() => submit(true)}>Сохранить промпт категории</button>{" "}<button className="ghost" disabled={busy} onClick={() => submit(false)}>Сохранить и переоценить категорию</button></p>
        <details><summary>Действующий полный запрос этой категории</summary><pre className="robot-log" style={{ whiteSpace: "pre-wrap" }}>{saved?.full_prompt}</pre></details>
      </> : <p className="notice">Промпт категории пока не получен от робота.</p>}
      {message && <p role="status">{message}</p>}
      {busy && <p role="status">Запрос обрабатывается роботом…</p>}
    </section>
    <ClassificationResult run={run ? { ...run, candidates } : null} />
    {run && <p className="hint">Без категории в прогоне: {run.candidates.filter(c => newsCategory(c) === "unclassified").length}. Такие материалы требуют классификации.</p>}
  </>;
}
