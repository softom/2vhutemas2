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

function Logo() {
  return (
    <>
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
        <p>
          Подпись над знаком — «ДВА ВХУТЕМАС РУ»: это прочтение адреса вслух, а не заявление о
          преемстве.
        </p>
      </div>

      <h2>Обложка</h2>
      <div className="about-text">
        <p>Ею сайт встречает входящего: держится пару секунд и уступает место содержимому.</p>
      </div>
      <CoverSheet />

      <h2>Конструктор знака</h2>
      <div className="about-text">
        <p className="hint">Знак пока рабочий. Ниже — конструктор, в котором его ищем.</p>
      </div>
      <SignBuilder />

      <p className="hint about-credit">
        Шрифты Oswald, Montserrat и Unbounded — © The Oswald, Montserrat и Unbounded Project
        Authors, SIL Open Font License 1.1.
      </p>
    </>
  );
}

function Philosophy() {
  return (
    <>
      <h2>Смещение точки наблюдателя</h2>
      <div className="about-text">
        <p>
          Объекты и студенческие работы живут здесь вместе, потому что во времени их разделяет
          только точка наблюдателя — <b>сегодня</b>. Разделение не в вещах, а в том, откуда на них
          смотрят. Лучший пример — само имя проекта: работы студентов ВХУТЕМАСа были учебными
          заданиями, а сегодня их изучают как объекты истории.
        </p>
        <blockquote>
          Мы не приравниваем — мы меняем оптику. Объект сегодня — проект вчера. Мастер сегодня —
          подмастерье вчера.
        </blockquote>
        <p>
          Это не уравнивание. Мастер остаётся мастером, студенческая работа не получает статуса
          шедевра даром: ценность не выдаётся ни датой, ни числом упоминаний — её обосновывают.
          Оптика работает в обе стороны: на шедевр смотрим как на проект, который когда-то был
          открыт и мог не получиться.
        </p>
        <p>
          Отсюда любовь к линии времени. Передвигая «сегодня» назад, читатель встаёт туда, где
          объект ещё проект, а мастер — подмастерье. Линия нужна не для того, чтобы расставить
          вещи по датам, а чтобы менять место, откуда смотришь.
        </p>
      </div>

      <h2>Смысл сайта</h2>
      <div className="about-text">
        <p>
          Ползунок упирается в «сегодня»: линия времени ведёт только назад, всё, что на ней есть,
          уже случилось. Будущее входит одним путём — его делают. Само слово «проект» от
          латинского <i>projectum</i>, «брошенное вперёд». Объекты — прошлое, которое мы смотрим.
          Проекты — будущее, которое мы делаем. Сайт — место, где они встречаются.
        </p>
        <p>
          Мы сводим вместе не авторов, а состояние: у мастеров работы тоже были проектами, и
          многие остались на бумаге. Мы не говорим, что студент станет мастером, — мы говорим,
          что и у мастера всё начиналось с проекта.
        </p>
        <p>
          Поэтому у нас не объекты, а <b>проекты</b>: взгляд сосредоточен на расчётах, чертежах и
          стремлениях. Удивляет проект, объект — его следствие. Купол Пантеона сегодня перекроют
          рутинно; незаурядно стремление перекрыть его тогда и расчёт, который это стремление
          удержал.
        </p>
      </div>

      <h2>Три основы</h2>
      <div className="about-text">
        <p>
          Вся модель стоит на трёх вещах, и новое не заводится отдельно — оно складывается из них.
        </p>
      </div>
      <table className="grid-table">
        <thead>
          <tr><th>Основа</th><th>Что это</th></tr>
        </thead>
        <tbody>
          <tr>
            <td><b>Запись</b></td>
            <td>
              Человек, здание, стиль, постановка — то, о чём говорим. Строение записи одно для
              всех, различает тип из дерева.
            </td>
          </tr>
          <tr>
            <td><b>Связь</b></td>
            <td>
              Утверждение об отношении двух записей. Обоснование обязательно: свобода связать
              оплачивается обязанностью объяснить.
            </td>
          </tr>
          <tr>
            <td><b>Параметр</b></td>
            <td>Величина и её значение у записи. Один смысл — один параметр, и у него есть определение.</td>
          </tr>
        </tbody>
      </table>
      <div className="about-text">
        <p>
          Авторство — это связь «человек → здание» с обоснованием. Событие — запись с датировкой и
          связями с участниками. Учебное сравнение — отбор записей по ветви и сортировка по
          величине. Отдельных таблиц для них нет.
        </p>
      </div>

      <h2>Учебный цикл</h2>
      <div className="about-text">
        <p>
          увидеть → вспомнить → сравнить → объяснить → проверить по источникам → пересмотреть
          вывод.
        </p>
      </div>
    </>
  );
}

/**
 * Манифест Артёма Антипова «О русском дизайне, который не нужно искать»
 * (исходник — Notion, база «ВХУТЕМАС 2.0»; правки для сайта согласованы
 * с автором 2026-09-27, Р-67). Текст авторский — править только с автором.
 */
function Manifest() {
  return (
    <div className="about-text manifest-text">
      <h2>О русском дизайне, который не нужно искать</h2>

      <h3>Предпосылка</h3>
      <p>
        Я вижу серьёзный запрос государства на определение «русского стиля», «русского дизайна».
        У этого запроса понятная природа: изоляция России в мировом сообществе требует
        определения культурной идентичности — что позволит нации развиваться. В ином случае —
        принятие позиции изгоев, ставит блок на развитие.
      </p>
      <p><b>Запрос легитимен. Но ответ на него находится не там, где его ищут.</b></p>

      <h3>1. Симптом</h3>
      <p>
        Когда возникает государственный запрос на определение «русского стиля» — этот запрос
        является <b>маркером разрыва культурной преемственности</b>. Нация, уверенная в своей
        идентичности, не задаёт этот вопрос. Она просто создаёт. Наличие такого вопроса
        означает, что естественное течение в формировании культурной идентичности нарушено.
      </p>

      <h3>2. Диагноз</h3>
      <p>Разрыв — повторяющийся жест: каждый новый период начинался с отказа от предыдущего.</p>
      <p>
        В 1932 году авангардные объединения были распущены, и язык пространства, который создали
        Мельников, Татлин, Леонидов, Родченко, Лисицкий, прервался на полуслове. В 1955-м борьба
        с «излишествами» закрыла эстетику сталинского ампира и оставила в прошлом имена тех, кто
        создал ВДНХ, — Олтаржевского, Щуко, Топуридзе; Полякова за гостиницу «Ленинградская»
        лишили Сталинской премии. В 1990-е в тень ушла поздняя советская проектная культура —
        вместе с Новым элементом расселения (НЭР) группы Скокана, Гутнова, Лежавы, который
        показывали на Миланской триеннале 1968 года и на Экспо-70 в Осаке.
      </p>
      <p>
        Советский авангард стал одним из источников мирового модернизма — от павильона Мельникова
        в Париже 1925 года до Захи Хадид, начинавшей с проекта «Тектоника Малевича». Советское
        стало восприниматься как вторичное. Результат — поколения дизайнеров и архитекторов,
        <b> не замечающие собственного культурного фундамента</b>.
      </p>
      <p><b>Важно не повторить отказ ещё раз.</b></p>

      <h3>3. Ложный путь</h3>
      <p>
        Поиск «русского стиля» через хохлому, гжель и кокошники. <b>Это часть культуры. Это
        важно.</b> Но в творчестве важна <b>актуальность</b>. Дизайн — не музей. <b>Надо
        базироваться на истории, но творить будущее.</b>
      </p>
      <p>Стилизация под «традицию» — это бегство от современности, а не обретение идентичности.</p>

      <h3>4. Основной тезис</h3>
      <p><b>Любой дизайн, созданный в России, является русским дизайном.</b></p>
      <p>
        Проблема не в отсутствии идентичности. Проблема — в <b>сомнении в праве на эту
        идентичность</b>. Вечный вопрос: «тварь ли я дрожащая или право имею?». Этот вопрос
        возникает из незнания масштаба русской — советской культуры последнего века в
        общемировой культуре.
      </p>
      <p><b>Мы — те, кто создал язык модернизма в ХХ веке.</b></p>

      <h3>5. Вывод</h3>
      <p><b>Русский дизайн не нужно искать. Его нужно активировать.</b></p>
      <p><b>Активировать</b> — значит:</p>
      <ul>
        <li>знать масштаб своего вклада в мировую культуру;</li>
        <li>легитимировать советское наследие не как ностальгию, а как <b>незавершённый авангард</b>;</li>
        <li>дать студентам право творить будущее, <b>не стесняясь своего происхождения</b>.</li>
      </ul>
      <p>
        Современные студенты и так сделают русский дизайн — если мы перестанем внушать им, что
        они вторичны.
      </p>
      <p><b>Мы не изгои. Мы — наследники тех, кто определил лицо ХХ века.</b></p>
      <p>Пора вспомнить.</p>

      <h3>6. Задача «поиска русского стиля»</h3>
      <p><b>Что можно сделать сейчас?</b></p>
      <p>
        Задача поиска должна быть сведена к признанию вклада в мировую культуру. Для этого
        необходима организация <b>цикла бесед и лекций, обращающих взгляд студентов на реальные
        достижения русской и советской культуры</b>. Понимание резонанса, который этот вклад
        создал в мировой культуре.
      </p>
      <p>
        Необходимо создать <b>позитивный вектор</b>, который обратит внимание специалистов на их
        корни, создаст ощущение гордости и позволит совершить это в пространстве творчества.
      </p>
      <p>
        Надо <b>учредить конкурс</b> студенческих и профессиональных работ, которые продвигают
        русский дизайн. Дать акцент — что русский дизайн это не изоляция, а движение вперёд.
        Любая работа, задающая новое в музыке, архитектуре или литературе — это пример русского
        дизайна. Критерий конкурса — авангардность!
      </p>
      <p><b>Русская традиция — быть впереди.</b></p>

      <p className="hint about-credit">Артём Антипов</p>
    </div>
  );
}

/**
 * Почтовый адрес проекта. Личную почту на сайт не выносим, а короткий
 * непредсказуемый ящик вместо info@ отсекает часть спама: по таким именам
 * сборщики адресов бьют вслепую (решение пользователя 2026-09-27).
 */
const MAIL = "aa@2vhutemas.ru";

function Feedback() {
  return (
    <>
      <div className="about-text">
        <p>
          Пишите на <a href={`mailto:${MAIL}`}>{MAIL}</a>. Это адрес проекта, его читают.
        </p>
        <p>
          Ждём замечаний по существу: ошибка в датировке, неверный автор, перепутанный
          объект, пропущенный источник. Атлас учебный, и неточность в нём дороже, чем
          в обычном тексте: по нему учатся.
        </p>
      </div>

      <h2>Изображения</h2>
      <div className="about-text">
        <p>
          Изображения приводятся как <b>цитаты в учебных целях</b> — с указанием автора и
          источника, в объёме, оправданном задачей обучения. Подпись с автором и источником
          стоит у каждого изображения; файл без них здесь просто не публикуется.
        </p>
        <p>
          Если вы правообладатель и считаете, что публикация задевает ваши права, напишите
          на <a href={`mailto:${MAIL}`}>{MAIL}</a> — укажите страницу и изображение.
          <b> Мы снимаем изображение по обращению, а разбираемся после,</b> а не наоборот.
        </p>
        <p>
          Если вы автор съёмки и хотите, чтобы подпись выглядела иначе или вела на вашу
          страницу, — это тоже к нам, поправим.
        </p>
      </div>
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
