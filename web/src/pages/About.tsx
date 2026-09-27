/**
 * О проекте: логотип, философия и манифест (Р-56, Р-57, Р-61).
 *
 * Три подраздела вместо одной длинной страницы: знак с конструктором сам по
 * себе занимает экран, а философию и манифест читают отдельно и дают на них
 * ссылки. Конструктор — игрушка для поиска знака: параметры живут в браузере
 * читателя и никуда не отправляются.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AXIS_LOOK, buildSign, FONTS, PALETTES, SIGN_DEFAULTS,
  type FontKey, type GlyphFont, type SignParams,
} from "../about/vh2Sign";
import { buildCover, COVER_DEFAULTS } from "../about/vh2Cover";

const STORE = "vh2-sign-params";
const HEX = /^#[0-9a-fA-F]{6}$/;

function loadParams(): SignParams {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) ?? "null");
    if (saved && typeof saved === "object") {
      const p = { ...SIGN_DEFAULTS, ...saved } as SignParams;
      // Цвета попадают в разметку SVG — берём только правильные коды.
      for (const k of ["paper", "ink", "red"] as const) if (!HEX.test(p[k])) p[k] = SIGN_DEFAULTS[k];
      if (!FONTS.some((f) => f.key === p.font)) p.font = SIGN_DEFAULTS.font;
      return p;
    }
  } catch {
    // Хранилище недоступно — начинаем с исходных значений.
  }
  return { ...SIGN_DEFAULTS };
}

type NumKey = { [K in keyof SignParams]: SignParams[K] extends number ? K : never }[keyof SignParams];
type Slider = [NumKey, string, number, number, number, (v: number) => string];

const pct = (v: number) => `${Math.round(v * 100)}%`;
const f2 = (v: number) => v.toFixed(2);

const PROPORTIONS: Slider[] = [
  ["big", "«В» к строке", 1.4, 4, 0.05, (v) => `${v.toFixed(2)}×`],
  ["xh", "Высота «х», доля строчной", 0.5, 1.45, 0.01, f2],
  ["stroke", "Толщина штриха «х»", 0.4, 1.6, 0.01, f2],
  ["sup", "Размер степени", 0.3, 0.85, 0.01, f2],
  ["supBold", "Насыщенность степени", 0, 1.2, 0.01, f2],
];
const TICKS: Slider[] = [
  ["ticks", "Засечки поперёк луча", 0, 9, 1, (v) => String(v)],
  ["tickLen", "Длина засечки, доля листа", 0.04, 0.7, 0.01, pct],
  ["tickGap", "Шаг засечек", 0.4, 3, 0.05, f2],
];
const FADE: Slider[] = [
  ["fadeL", "Слева, доля слова", 0, 1, 0.01, pct],
  ["fadeR", "Справа, доля слова", 0, 1, 0.01, pct],
  ["dot", "Шаг растра", 3, 16, 0.5, (v) => v.toFixed(1)],
];
const SHEET: Slider[] = [
  ["hr", "Высота листа к ширине", 0.35, 1.3, 0.01, f2],
  ["by", "Положение строки", 0.15, 0.85, 0.01, pct],
];

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function SignBuilder() {
  const [p, setP] = useState<SignParams>(loadParams);
  const [fonts, setFonts] = useState<Partial<Record<FontKey, GlyphFont>>>({});
  const [status, setStatus] = useState("");
  const font = fonts[p.font];

  // Контуры шрифта грузятся отдельным файлом и только когда шрифт выбран.
  useEffect(() => {
    if (fonts[p.font]) return;
    const entry = FONTS.find((f) => f.key === p.font) ?? FONTS[0];
    entry.load()
      .then((g) => setFonts((old) => ({ ...old, [entry.key]: g })))
      .catch(() => setStatus("Шрифт не загрузился — обновите страницу."));
  }, [p.font, fonts]);

  const svg = useMemo(() => (font ? buildSign(p, font) : ""), [p, font]);

  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify(p));
    } catch {
      // Не запомнили — не беда, знак всё равно нарисован.
    }
  }, [p]);

  const set = <K extends keyof SignParams>(k: K, v: SignParams[K]) => setP((old) => ({ ...old, [k]: v }));
  const merge = (patch: Partial<SignParams>) => setP((old) => ({ ...old, ...patch }));

  const savePng = () => {
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth * 2;
      c.height = img.naturalHeight * 2;
      c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => {
        if (b) download("vh2.png", b);
        setStatus(b ? `PNG ${c.width}×${c.height} сохранён.` : "PNG не собрался — сохраните SVG.");
      }, "image/png");
    };
    img.onerror = () => setStatus("PNG не собрался — сохраните SVG.");
    img.src = url;
  };

  const copyParams = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(p, null, 1));
      setStatus("Параметры скопированы.");
    } catch {
      setStatus("Буфер обмена недоступен в этом браузере.");
    }
  };

  const range = ([k, label, min, max, step, show]: Slider) => (
    <label key={k} className="sign-range">
      <span>{label}</span>
      <output>{show(p[k])}</output>
      <input type="range" min={min} max={max} step={step} value={p[k]}
        onChange={(e) => set(k, parseFloat(e.target.value))} />
    </label>
  );

  return (
    <div className="sign-builder">
      <div className="sign-stage">
        {svg
          ? <div className="sign-preview" dangerouslySetInnerHTML={{ __html: svg }} />
          : <div className="sign-preview sign-loading">Загружаем шрифт…</div>}
        <div className="sign-actions">
          <button type="button" disabled={!svg}
            onClick={() => download("vh2.svg", new Blob([svg], { type: "image/svg+xml" }))}>
            Скачать SVG
          </button>
          <button type="button" className="ghost" disabled={!svg} onClick={savePng}>Скачать PNG</button>
          <button type="button" className="ghost" onClick={copyParams}>Скопировать параметры</button>
          <button type="button" className="ghost" onClick={() => { merge(AXIS_LOOK); setStatus("Вертикальная ось, засечки, штриховка, печать 1920-х."); }}>
            Как в пробе: ось
          </button>
          <button type="button" className="ghost" onClick={() => { setP({ ...SIGN_DEFAULTS }); setStatus("Исходные параметры."); }}>
            Сбросить
          </button>
        </div>
        {status && <p className="hint" role="status">{status}</p>}
      </div>

      <form className="sign-controls" onSubmit={(e) => e.preventDefault()}>
        <fieldset>
          <legend>Текст и шрифт</legend>
          <label>
            Шрифт
            <select value={p.font} onChange={(e) => set("font", e.target.value as FontKey)}>
              {FONTS.map((f) => <option key={f.key} value={f.key}>{f.name} — {f.note}</option>)}
            </select>
          </label>
          <div className="sign-pair">
            <label>Слово слева<input value={p.leftWord} onChange={(e) => set("leftWord", e.target.value)} /></label>
            <label>Слово справа<input value={p.rightWord} onChange={(e) => set("rightWord", e.target.value)} /></label>
            <label>Большая буква<input value={p.bigLetter} maxLength={2} onChange={(e) => set("bigLetter", e.target.value)} /></label>
            <label>Степень<input value={p.exponent} maxLength={2} onChange={(e) => set("exponent", e.target.value)} /></label>
          </div>
          <label className="sign-check">
            <input type="checkbox" checked={p.showDot} onChange={(e) => set("showDot", e.target.checked)} />
            Знак умножения «·»
          </label>
        </fieldset>

        <fieldset>
          <legend>Угол «х» и луч</legend>
          {range(["angle", "Наклон к горизонтали", 30, 90, 0.5, (v) => `${v.toFixed(1)}°`])}
          <div className="sign-chips">
            {(font?.presets ?? []).map(([ch, a]) => (
              <button key={ch} type="button" className="ghost" onClick={() => set("angle", a)}>
                как «{ch}» — {a}°
              </button>
            ))}
            <button type="button" className="ghost" onClick={() => set("angle", 90)}>ось — 90°</button>
          </div>
          <p className="hint">Углы диагоналей выбранного шрифта, измерены по контурам букв. При 90° «х» становится осью.</p>
          <label>
            Луч — продолжение восходящего штриха
            <select value={p.beam} onChange={(e) => set("beam", e.target.value as SignParams["beam"])}>
              <option value="down">вниз, до края листа</option>
              <option value="both">насквозь: над строкой и вниз до края</option>
              <option value="up">вверх, до края листа</option>
              <option value="none">без луча</option>
            </select>
          </label>
          <label className="sign-check">
            <input type="checkbox" checked={p.xRed} onChange={(e) => set("xRed", e.target.checked)} />
            «х» красная (иначе красный только луч)
          </label>
          {TICKS.map(range)}
        </fieldset>

        <fieldset>
          <legend>Пропорции</legend>
          {PROPORTIONS.map(range)}
        </fieldset>

        <fieldset>
          <legend>Затухание</legend>
          <label>
            Чем набран тон
            <select value={p.fadeStyle} onChange={(e) => set("fadeStyle", e.target.value as SignParams["fadeStyle"])}>
              <option value="dots">полутоновая точка</option>
              <option value="hatch">штриховка под 45°</option>
            </select>
          </label>
          {FADE.map(range)}
        </fieldset>

        <fieldset>
          <legend>Лист</legend>
          {SHEET.map(range)}
          <div className="sign-chips">
            {PALETTES.map((pal) => (
              <button key={pal.name} type="button" className="ghost"
                onClick={() => merge({ paper: pal.paper, ink: pal.ink, red: pal.red })}>
                {pal.name}
              </button>
            ))}
          </div>
          <div className="sign-pair">
            <label>Бумага<input type="color" value={p.paper} onChange={(e) => set("paper", e.target.value)} /></label>
            <label>Краска<input type="color" value={p.ink} onChange={(e) => set("ink", e.target.value)} /></label>
            <label>Красный<input type="color" value={p.red} onChange={(e) => set("red", e.target.value)} /></label>
            <label className="sign-check">
              <input type="checkbox" checked={p.transparent} onChange={(e) => set("transparent", e.target.checked)} />
              Прозрачный фон
            </label>
          </div>
        </fieldset>
      </form>
    </div>
  );
}

/** Обложка проекта — она же заставка на входе (Р-58). */
function CoverSheet() {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    const entry = FONTS.find((f) => f.key === "montserrat") ?? FONTS[0];
    entry.load().then((g) => setSvg(buildCover(COVER_DEFAULTS, g))).catch(() => {});
  }, []);
  if (!svg) return <div className="cover-sheet sign-loading">Загружаем шрифт…</div>;
  return <div className="cover-sheet" dangerouslySetInnerHTML={{ __html: svg }} />;
}

import {
  BuilderNote, CoverNote, Feedback, FontsCredit, LogoIntro, Manifest, Philosophy,
} from "../about/texts";
function Logo() {
  return (
    <>
      <LogoIntro />

      <h2>Обложка</h2>
      <CoverNote />
      <CoverSheet />

      <h2>Конструктор знака</h2>
      <BuilderNote />
      <SignBuilder />

      <FontsCredit />
    </>
  );
}

const SECTIONS = [
  { key: "logo", title: "Логотип", node: <Logo /> },
  { key: "philosophy", title: "Философия", node: <Philosophy /> },
  { key: "manifest", title: "Манифест", node: <Manifest /> },
  { key: "feedback", title: "Обратная связь", node: <Feedback /> },
];

export function About() {
  // Подразделы — отдельные адреса: на «Философию» и «Манифест» дают ссылку,
  // и по ней должен открываться именно подраздел (Р-61).
  const { section } = useParams();
  const current = SECTIONS.find((s) => s.key === section) ?? SECTIONS[0];

  return (
    <section className="about">
      <h1>О проекте</h1>
      <p className="sub">2vhutemas — учебный атлас объектов культуры и их места в истории.</p>

      <nav className="subnav">
        {SECTIONS.map((s) => (
          <Link key={s.key} to={`/about/${s.key}`} className={s.key === current.key ? "active" : ""}>
            {s.title}
          </Link>
        ))}
      </nav>

      {current.node}
    </section>
  );
}
