/**
 * Каркас интерфейса нового контура: навигация, вход и экраны этапа 1.
 * Интерфейс на русском, отдельного слоя перевода нет (решение Р-18).
 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Link, Route, Routes, useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { setInAppNavigate } from "./editor/entityBlocks";
import { useScrollMemory } from "./ui/scrollMemory";
import { api, supabase } from "./api";
import { Catalog } from "./pages/Catalog";

const EntityEditor = lazy(() => import("./pages/EntityEditor").then((m) => ({ default: m.EntityEditor })));
import { Lectures } from "./pages/Lectures";

const MediaLibrary = lazy(() => import("./pages/MediaLibrary").then((m) => ({ default: m.MediaLibrary })));
const Parameters = lazy(() => import("./pages/Parameters").then((m) => ({ default: m.Parameters })));
const NewsRobot = lazy(() => import("./pages/NewsRobot").then((m) => ({ default: m.NewsRobot })));
import { Login } from "./pages/Login";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { Splash } from "./ui/Splash";
import { bindSearchKeys, openSearch } from "./search/keys";

// Поиск по «/» и Ctrl+K (Р-109) — один слушатель на всё приложение.
bindSearchKeys();

export interface Viewer {
  authenticated: boolean;
  displayName: string;
  permissions: string[];
}

/**
 * С какого адреса открыли сайт. Заставку показываем только тем, кто пришёл
 * на корень: переход внутри сайта её не повторяет, прямая ссылка на запись
 * ведёт сразу к записи (Р-58).
 */
const ENTRY = globalThis.location.pathname;

/** Счётчик Яндекс.Метрики; сам код счётчика — в index.html (Р-66). */
const METRIKA_ID = 108525511;

function NotFound() {
  return (
    <section>
      <h1>Страница не найдена</h1>
      <p className="notice">
        Такой страницы нет. Возможно, запись ещё не опубликована или адрес набран с ошибкой.
      </p>
      <p><Link to="/">На главную</Link></p>
    </section>
  );
}

/** Какой файл сборки сейчас выполняется в этой вкладке. */
function currentBundle(): string | null {
  const script = document.querySelector('script[type="module"][src*="/assets/"]');
  const src = script?.getAttribute("src") ?? null;
  return src ? src.split("/").pop() ?? null : null;
}

function PublicEntityPage() {
  useEffect(() => {
    // Публичная карточка имеет один серверный HTML-рендер для прямых ссылок,
    // каталога и возврата из редактора. Не строим вторую React-копию.
    globalThis.location.replace(globalThis.location.href);
  }, []);
  return null;
}
export function App() {
  const [headerHtml, setHeaderHtml] = useState("");
  // Футер приходит с сервера вместе с меню; до ответа держим тот, что уже
  // нарисовала готовая страница, — подмена не видна.
  const [footerHtml, setFooterHtml] = useState(() => document.querySelector(".site-foot")?.innerHTML ?? "");
  // Вставки в строке текста рисуются без React и переходят по ссылке через
  // этот маршрутизатор — чтобы не терять место в тексте (см. entityBlocks).
  const navigate = useNavigate();
  useEffect(() => {
    setInAppNavigate(navigate);
    return () => setInAppNavigate(null);
  }, [navigate]);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  // Открытая вкладка продолжает работать на старом коде, пока её не
  // перезагрузят: после выкладки это выглядело как «кнопка не сохраняет».
  const [stale, setStale] = useState(false);
  const [splash, setSplash] = useState(ENTRY === "/" || ENTRY === "");
  const location = useLocation();
  // Возврат со страницы объекта приводит туда, откуда ушли: лекцию читают
  // подряд, и начинать сначала после каждой карточки невозможно.
  useScrollMemory();

  // Заголовок вкладки: у записи своё название (его ставит карточка),
  // у остальных страниц — имя сайта, иначе держалось бы имя прошлой записи.
  useEffect(() => {
    if (!location.pathname.startsWith("/entities/")) document.title = "2ВХУТЕМАС";
  }, [location.pathname]);

  // Метрика (Р-66) сама засчитывает только первую загрузку; переходы внутри
  // сайта идут без перезагрузки, и о них сообщаем сами. Первый адрес уже
  // засчитан при загрузке — его пропускаем, иначе вход считался бы дважды.
  const lastHit = useRef(globalThis.location.href);
  const navigationType = useNavigationType();
  useEffect(() => {
    const url = globalThis.location.href;
    if (url === lastHit.current) return;
    const referer = lastHit.current;
    lastHit.current = url;
    // Замена адреса без шага в истории — это та же страница под постоянным
    // адресом (номер записи → слаг, Р-65), а не новый просмотр.
    if (navigationType === "REPLACE") return;
    // Название записи карточка ставит после загрузки — даём ей мгновение.
    const timer = setTimeout(() => {
      const ym = (globalThis as { ym?: (...args: unknown[]) => void }).ym;
      ym?.(METRIKA_ID, "hit", url, { referer, title: document.title });
    }, 500);
    return () => clearTimeout(timer);
  }, [location.pathname, location.search]);

  const refresh = async () => {
    try {
      const { html, footer, viewer: me } = await api.siteHeader(location.pathname);
      setHeaderHtml(html);
      setFooterHtml(footer);
      // Кука нужна, чтобы браузер показывал приватные файлы в тегах изображений.
      if (me.authenticated) api.openMediaSession().catch(() => {});
      setViewer(me);
    } catch {
      setViewer({ authenticated: false, displayName: "Гость", permissions: [] });
    }
  };

  useEffect(() => { void refresh(); }, [location.pathname]);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange(() => { setTimeout(() => { void refresh(); }, 0); });
    return () => data.subscription.unsubscribe();
  }, []);

  // Сверяем имя файла сборки со страницей на сервере: имя содержит
  // отпечаток содержимого, поэтому другое имя значит новую выкладку.
  useEffect(() => {
    const mine = currentBundle();
    if (!mine) return;
    const check = async () => {
      try {
        const html = await (await fetch("/", { cache: "no-store" })).text();
        const found = html.match(/assets\/index-[A-Za-z0-9_-]+\.js/);
        if (found && !found[0].endsWith(mine)) setStale(true);
      } catch {
        // Сеть недоступна — молчим: это не повод пугать сообщением.
      }
    };
    check();
    const timer = setInterval(check, 5 * 60 * 1000);
    globalThis.addEventListener("focus", check);
    return () => {
      clearInterval(timer);
      globalThis.removeEventListener("focus", check);
    };
  }, []);

  // Постоянная ссылка: иначе перерисовка каркаса сбрасывает отсчёт заставки.
  const hideSplash = useCallback(() => setSplash(false), []);

  const can = (permission: string) =>
    viewer?.permissions.includes(permission) || viewer?.permissions.includes("su") || false;

  // Лента знака идёт через публичные страницы; рабочие экраны — без неё (Р-91).
  const reading = ["/", "/news", "/objects", "/authors", "/about", "/lectures"].includes(location.pathname) ||
    (/^\/entities\/[^/]+$/.test(location.pathname) && location.pathname !== "/entities/new");

  return (
    <div className="shell">
      {splash && <Splash onDone={hideSplash} />}
      {reading && <div className="through" aria-hidden="true" />}
      {reading && <div className="through-marks" aria-hidden="true" />}
      <header className="top" data-site-header
        dangerouslySetInnerHTML={{ __html: headerHtml }}
        onClick={async (event) => {
          const target = event.target as HTMLElement;
          // Замечания поверх страницы (Р-95): слой грузится только по нажатию.
          if (target.closest('[data-action="notes"]')) {
            const { toggleNotes } = await import("./notes/layer");
            toggleNotes();
            return;
          }
          if (target.closest('[data-action="search"]')) {
            openSearch();
            return;
          }
          if (target.closest('[data-action="signout"]')) {
            await supabase.auth.signOut();
            await refresh();
          }
        }} />

      {stale && (
        <div className="stale-banner">
          <span>
            Вышла новая версия приложения. Эта вкладка работает на прежней —
            перезагрузите её, иначе правки могут не сохраниться.
          </span>
          <button type="button" onClick={() => globalThis.location.reload()}>
            Обновить страницу
          </button>
        </div>
      )}

      <main>
        <ErrorBoundary key={location.pathname}>
        <Suspense fallback={<p className="notice">Загружаем раздел…</p>}>
        <Routes>
          {/* Главная и архив — лента новостей, готовый HTML сервера (Р-88): своей
              React-копии нет, как у страницы записи. */}
          <Route path="/" element={<PublicEntityPage />} />
          <Route path="/news" element={<PublicEntityPage />} />
          <Route
            path="/objects"
            element={
              <Catalog
                canCreate={can("create_delete")}
                branch="what"
                title="Проекты"
                sub="Построенное и оставшееся на бумаге: смотрим на расчёт, чертёж и стремление."
              />
            }
          />
          <Route
            path="/authors"
            element={
              <Catalog
                canCreate={can("create_delete")}
                branch="who"
                title="Авторы"
                sub="Люди, бюро и коллективы."
              />
            }
          />
          <Route path="/entities/new" element={<EntityEditor mode="create" />} />
          <Route path="/entities/:id" element={<PublicEntityPage />} />
          <Route path="/entities/:id/edit" element={!viewer ? <p className="notice">Проверяем права…</p> : can("edit") ? <EntityEditor mode="edit" /> : <p className="error">Недостаточно прав для редактирования.</p>} />
          <Route path="/lectures" element={<Lectures canCreate={can("create_delete")} />} />
          <Route path="/media" element={<MediaLibrary canUpload={can("create_delete")} />} />
          <Route path="/parameters" element={<Parameters canManage={can("su")} />} />
          <Route path="/robot" element={!viewer ? <p className="notice">Проверяем права…</p> : <NewsRobot allowed={can("su")} />} />
          <Route path="/robot/:section" element={!viewer ? <p className="notice">Проверяем права…</p> : <NewsRobot allowed={can("su")} />} />
          <Route path="/robot/:section/:key" element={!viewer ? <p className="notice">Проверяем права…</p> : <NewsRobot allowed={can("su")} />} />
          <Route path="/about" element={
            <Catalog
              canCreate={can("create_delete")}
              branch="project_pages"
              title="О проекте"
              sub="Зачем создан 2ВХУТЕМАС, как устроен атлас и как связаться с проектом."
            />
          } />

          <Route path="/login" element={<Login onDone={refresh} />} />
          {/* Неизвестный адрес — честное «не найдено», а не переброс на главную:
              сервер отвечает на него 404, и страница говорит то же (Р-65). */}
          <Route path="*" element={<NotFound />} />
        </Routes>
        </Suspense>
        </ErrorBoundary>
      </main>

      {/* Тот же футер, что у готовых страниц: один на оба (siteHeader.ts, siteFooter). */}
      <footer className="site-foot" dangerouslySetInnerHTML={{ __html: footerHtml }} />
    </div>
  );
}
