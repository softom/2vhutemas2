import { CATEGORY_NAMES, newsCategory } from "./newsCategories";
import { Link } from "react-router-dom";
import type { RobotOverview, RobotRunView } from "../api";

export const ROBOT_BLOCKS = [
  { id: "collect", number: "1", title: "Сбор", path: "/robot/collect", description: "Обход источников, полученные материалы и ошибки сбора.", sections: ["collect", "sites", "log"] },
  { id: "classify", number: "2", title: "Классификатор", path: "/robot/classify", description: "Оценки робота, совпадения, промпт и результаты обучения.", sections: ["classify"] },
  { id: "editor", number: "3", title: "Редактор", path: "/robot/news", description: "Решения по кандидатам, заказы, подготовка и стек выпуска.", sections: ["news", "orders", "stack", "resonance", "preview"] },
  { id: "sources", number: "4", title: "Расширение источников", path: "/robot/recs", description: "Новые сайты, проверка и решение о подключении.", sections: ["recs"] },
] as const;

const SUBPAGES: Record<string, [string, string, string][]> = {
  collect: [["collect", "/robot/collect", "Результат сбора"], ["sites", "/robot/sites", "Подключённые сайты"], ["log", "/robot/log", "Журнал прогона"]],
  editor: [["news", "/robot/news", "Кандидаты"], ["orders", "/robot/orders", "Заказать новость"], ["stack", "/robot/stack", "Стек выпуска"], ["resonance", "/robot/resonance", "Резонанс"]],
};

export function RobotBlockNav({ section }: { section: string }) {
  const active = ROBOT_BLOCKS.find((b) => (b.sections as readonly string[]).includes(section));
  return <>
    <nav className="robot-block-nav" aria-label="Блоки робота">
      {ROBOT_BLOCKS.map((b) => <Link key={b.id} to={b.path} className={active?.id === b.id ? "active" : undefined}
        aria-current={active?.id === b.id ? "page" : undefined}>
        <span className="robot-block-number" aria-hidden="true">{b.number}</span><span>{b.title}</span>
      </Link>)}
    </nav>
    {active && SUBPAGES[active.id] && <nav className={active.id === "editor" ? "robot-block-nav robot-editor-nav" : "robot-tabs filters"} aria-label={`Разделы блока «${active.title}»`}>
      {SUBPAGES[active.id].map(([code, path, title]) => <Link key={code} to={path}
        className={section === code || (section === "preview" && code === "news") ? "active" : undefined}
        aria-current={section === code ? "page" : undefined}>{title}</Link>)}
    </nav>}
    {active && active.id !== "classify" && <header className="robot-block-heading"><h2>Блок {active.number}. {active.title}</h2><p className="hint">{active.description}</p></header>}
  </>;
}

export function RobotDashboard({ ov, run }: { ov: RobotOverview; run: RobotRunView | null }) {
  const values = [
    `${ov.sources.filter((s) => s.enabled).length} подключённых источников`,
    run ? `${run.candidates.length} историй в выбранном прогоне` : "Прогонов пока нет",
    `${ov.queue.items.length} в стеке выпуска`,
    `${ov.candidates.filter((c) => ["новый", "ждёт решения"].includes(c.status)).length} источников ждут решения`,
  ];
  return <div className="robot-block-grid">
    {ROBOT_BLOCKS.map((b, i) => <Link className="robot-block-card" to={b.path} key={b.id}>
      <span className="robot-block-number" aria-hidden="true">{b.number}</span>
      <h2>{b.title}</h2><p>{b.description}</p><strong>{values[i]}</strong>
    </Link>)}
  </div>;
}

export function CollectionResult({ run }: { run: RobotRunView | null }) {
  if (!run) return <p className="notice">После первого обхода здесь появятся полученные материалы и результаты по источникам.</p>;
  const failed = run.feeds.filter((f) => f.status.startsWith("ошибка"));
  return <>
    <div className="robot-summary" aria-label="Итоги сбора">
      <span><b>{run.items}</b> новых материалов</span><span><b>{run.feeds.length}</b> источников обработано</span>
      <span><b>{failed.length}</b> ошибок источников</span>
    </div>
    <h3>Материалы выбранного прогона</h3>
    <p className="hint">Показаны итоги получения по источникам. Просмотр полного стека сырых новостей с медиа ещё не подключён.</p>
    {run.feeds.length === 0 ? <p className="notice">Результаты появятся по мере обхода источников.</p> :
      <div className="robot-table-scroll" role="region" aria-label="Результаты обхода источников" tabIndex={0}>
        <table className="grid-table"><thead><tr><th>Источник</th><th>В выдаче</th><th>Новых</th><th>Состояние</th></tr></thead>
          <tbody>{run.feeds.map((f) => <tr key={f.id}><td>{f.title}</td><td>{f.items}</td><td>{f.new}</td><td>{f.status}</td></tr>)}</tbody>
        </table>
      </div>}
    <p><Link to="/robot/classify">Перейти к классификатору →</Link></p>
  </>;
}

export function ClassificationResult({ run }: { run: RobotRunView | null }) {
  if (!run) return <p className="notice">Результаты классификации появятся после первого прогона.</p>;
  return <>
    <h3>Результат выбранного прогона</h3>
    <p className="hint">Критерии разделены по шести категориям. Для прежних историй категория определена по теме и виду материала; после переоценки используется результат классификации. Постоянная память отказов ещё требует реализации.</p>
    {run.candidates.length === 0 ? <p className="notice">{run.running ? "Оценка идёт. Готовые истории появятся после объединения повторов." : "В этом прогоне кандидатов нет."}</p> :
      <div className="robot-table-scroll" role="region" aria-label="Результаты классификации" tabIndex={0}>
        <table className="grid-table"><thead><tr><th>История</th><th>Тема</th><th>Оценка</th><th>Совпадения</th><th>Основание</th></tr></thead>
          <tbody>{run.candidates.map((c) => <tr key={c.story_key}>
            <td>{c.title_ru}</td><td>{CATEGORY_NAMES[newsCategory(c)] ?? "Без категории"}</td>
            <td>{c.final}</td><td>{c.site?.news ? "Есть опубликованная новость" : c.repeats?.length ? `Повторов: ${c.repeats.length}` : "Совпадений не указано"}</td>
            <td>{c.reason || "—"}</td>
          </tr>)}</tbody>
        </table>
      </div>}
    <p><Link to="/robot/news">Рассмотреть кандидатов в редакторе →</Link></p>
  </>;
}
