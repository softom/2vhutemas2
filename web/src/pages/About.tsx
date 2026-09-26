/**
 * О проекте: назначение и знак «Искусство = Вх² · м» с конструктором (Р-56).
 *
 * Конструктор — игрушка для поиска знака: параметры живут в браузере
 * читателя и никуда не отправляются.
 */
import { useEffect, useMemo, useState } from "react";
import { ANGLE_PRESETS, buildSign, SIGN_DEFAULTS, type SignParams } from "../about/vh2Sign";

const STORE = "vh2-sign-params";
const HEX = /^#[0-9a-fA-F]{6}$/;

function loadParams(): SignParams {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) ?? "null");
    if (saved && typeof saved === "object") {
      const p = { ...SIGN_DEFAULTS, ...saved } as SignParams;
      // Цвета попадают в разметку SVG — берём только правильные коды.
      for (const k of ["paper", "ink", "red"] as const) if (!HEX.test(p[k])) p[k] = SIGN_DEFAULTS[k];
      return p;
    }
  } catch {
    // Хранилище недоступно — начинаем с исходных значений.
  }
  return { ...SIGN_DEFAULTS };
}

type NumKey = { [K in keyof SignParams]: SignParams[K] extends number ? K : never }[keyof SignParams];

const SLIDERS: { group: string; items: [NumKey, string, number, number, number, (v: number) => string][] }[] = [
  {
    group: "Угол «х» и луча",
    items: [["angle", "Наклон к горизонтали", 50, 85, 0.1, (v) => `${v.toFixed(1)}°`]],
  },
  {
    group: "Пропорции",
    items: [
      ["big", "«В» к строке", 1.4, 4, 0.05, (v) => `${v.toFixed(2)}×`],
      ["xh", "Высота «х», доля строчной", 0.5, 1.45, 0.01, (v) => v.toFixed(2)],
      ["stroke", "Толщина штриха «х»", 0.4, 1.6, 0.01, (v) => v.toFixed(2)],
      ["sup", "Размер степени", 0.3, 0.85, 0.01, (v) => v.toFixed(2)],
      ["supBold", "Насыщенность степени", 0, 1.2, 0.01, (v) => v.toFixed(2)],
    ],
  },
  {
    group: "Затухание",
    items: [
      ["fadeL", "Слева, доля слова", 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`],
      ["fadeR", "Справа, доля слова", 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`],
      ["dot", "Шаг растра", 3, 16, 0.5, (v) => v.toFixed(1)],
    ],
  },
  {
    group: "Лист",
    items: [
      ["hr", "Высота листа к ширине", 0.35, 1.3, 0.01, (v) => v.toFixed(2)],
      ["by", "Положение строки", 0.15, 0.85, 0.01, (v) => `${Math.round(v * 100)}%`],
    ],
  },
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
  const [status, setStatus] = useState("");
  const svg = useMemo(() => buildSign(p), [p]);

  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify(p));
    } catch {
      // Не запомнили — не беда, знак всё равно нарисован.
    }
  }, [p]);

  const set = <K extends keyof SignParams>(k: K, v: SignParams[K]) => setP((old) => ({ ...old, [k]: v }));

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

  return (
    <div className="sign-builder">
      <div className="sign-stage">
        <div className="sign-preview" dangerouslySetInnerHTML={{ __html: svg }} />
        <div className="sign-actions">
          <button type="button" onClick={() => download("vh2.svg", new Blob([svg], { type: "image/svg+xml" }))}>
            Скачать SVG
          </button>
          <button type="button" className="ghost" onClick={savePng}>Скачать PNG</button>
          <button type="button" className="ghost" onClick={copyParams}>Скопировать параметры</button>
          <button type="button" className="ghost" onClick={() => { setP({ ...SIGN_DEFAULTS }); setStatus("Исходные параметры."); }}>
            Сбросить
          </button>
        </div>
        {status && <p className="hint" role="status">{status}</p>}
      </div>

      <form className="sign-controls" onSubmit={(e) => e.preventDefault()}>
        <fieldset>
          <legend>Текст</legend>
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

        {SLIDERS.map(({ group, items }) => (
          <fieldset key={group}>
            <legend>{group}</legend>
            {items.map(([k, label, min, max, step, show]) => (
              <label key={k} className="sign-range">
                <span>{label}</span>
                <output>{show(p[k])}</output>
                <input type="range" min={min} max={max} step={step} value={p[k]}
                  onChange={(e) => set(k, parseFloat(e.target.value))} />
              </label>
            ))}
            {group === "Угол «х» и луча" && (
              <>
                <div className="sign-chips">
                  {ANGLE_PRESETS.map(([ch, a]) => (
                    <button key={ch} type="button" className="ghost" onClick={() => set("angle", a)}>
                      как «{ch}» — {a}°
                    </button>
                  ))}
                </div>
                <p className="hint">Углы диагоналей Oswald Bold, измерены по контурам букв.</p>
                <label>
                  Луч — продолжение восходящего штриха
                  <select value={p.beam} onChange={(e) => set("beam", e.target.value as SignParams["beam"])}>
                    <option value="down">вниз-влево, до края листа</option>
                    <option value="up">вверх-вправо, до края листа</option>
                    <option value="none">без луча</option>
                  </select>
                </label>
              </>
            )}
            {group === "Лист" && (
              <div className="sign-pair">
                <label>Бумага<input type="color" value={p.paper} onChange={(e) => set("paper", e.target.value)} /></label>
                <label>Краска<input type="color" value={p.ink} onChange={(e) => set("ink", e.target.value)} /></label>
                <label>Красный<input type="color" value={p.red} onChange={(e) => set("red", e.target.value)} /></label>
                <label className="sign-check">
                  <input type="checkbox" checked={p.transparent} onChange={(e) => set("transparent", e.target.checked)} />
                  Прозрачный фон
                </label>
              </div>
            )}
          </fieldset>
        ))}
      </form>
    </div>
  );
}

export function About() {
  return (
    <section className="about">
      <h1>О проекте</h1>
      <p className="sub">2vhutemas — учебный проект об объектах культуры и их месте в истории.</p>

      <div className="about-text">
        <p>
          Проект помогает студентам расширить кругозор, запомнить авторов и объекты, увидеть
          отношения между ними и сформировать критическое знание. Здание, человек, стиль,
          постановка — всё это записи одного строения; между ними — связи, и у каждой связи
          есть обоснование.
        </p>
        <p>
          Учебный цикл: увидеть → вспомнить → сравнить → объяснить → проверить по источникам →
          пересмотреть вывод.
        </p>
      </div>

      <h2>Знак: Искусство = Вх² · м</h2>
      <div className="about-text">
        <p>
          Формула спрятана в самом названии: ВХ-У-ТЕ-МАС читается как «Вх two mass», то есть
          Вх² · м. Поэтому порядок задан словом: вслух «Вх² · м» складывается в «ВХУТЕМАС».
        </p>
        <p>
          Двойка — степень, а не индекс: второй ВХУТЕМАС не удвоение первого, а он же в новой
          степени, как c² у Эйнштейна. «м» несёт три смысла сразу: мастерские, материя и массы.
          Знак пишется кириллицей — поиск русского стиля не начинают с латиницы.
        </p>
        <p className="hint">Знак пока рабочий. Ниже — конструктор, в котором его ищем.</p>
      </div>

      <SignBuilder />

      <p className="hint about-credit">Шрифт Oswald — Vernon Adams и соавторы, SIL Open Font License 1.1.</p>
    </section>
  );
}
