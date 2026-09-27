/**
 * Каркас интерфейса нового контура: навигация, вход и экраны этапа 1.
 * Интерфейс на русском, отдельного слоя перевода нет (решение Р-18).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Route, Routes, useLocation, useNavigationType } from "react-router-dom";
import { useScrollMemory } from "./ui/scrollMemory";
import { api, supabase } from "./api";
import { Catalog } from "./pages/Catalog";
import { EntityPage } from "./pages/EntityPage";
import { EntityEditor } from "./pages/EntityEditor";
import { Lectures } from "./pages/Lectures";
import { About } from "./pages/About";
import { MediaLibrary } from "./pages/MediaLibrary";
import { Parameters } from "./pages/Parameters";
import { Login } from "./pages/Login";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { Splash } from "./ui/Splash";

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

export function App() {
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
      const me = await api.me();
      // Кука нужна, чтобы браузер показывал приватные файлы в тегах изображений.
      if (me.authenticated) api.openMediaSession().catch(() => {});
      setViewer({
        authenticated: me.authenticated,
        displayName: me.display_name ?? "Гость",
        permissions: me.permissions ?? [],
      });
    } catch {
      setViewer({ authenticated: false, displayName: "Гость", permissions: [] });
    }
  };

  useEffect(() => {
    refresh();
    const { data } = supabase.auth.onAuthStateChange(() => refresh());
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

  return (
    <div className="shell">
      {splash && <Splash onDone={hideSplash} />}
      <header className="top">
        <Link className="brand" to="/">2vhutemas</Link>
        <nav>
          {/* «Всё» — общий список: разделы ниже показывают по ветви, а сюда
              попадает и то, у чего своего раздела пока нет (Р-55). */}
          <Link to="/" className={location.pathname === "/" ? "active" : ""}>Всё</Link>
          <Link to="/objects" className={location.pathname === "/objects" ? "active" : ""}>
            Проекты
          </Link>
          <Link to="/authors" className={location.pathname === "/authors" ? "active" : ""}>
            Авторы
          </Link>
          <Link to="/lectures" className={location.pathname === "/lectures" ? "active" : ""}>
            Лекции
          </Link>
          <Link to="/media" className={location.pathname.startsWith("/media") ? "active" : ""}>
            Медиатека
          </Link>
          {can("edit") && (
            <Link to="/parameters" className={location.pathname === "/parameters" ? "active" : ""}>
              Параметры
            </Link>
          )}
          {can("create_delete") && <Link to="/entities/new">Создать запись</Link>}
          {/* «О проекте» стоит последним: это не рабочий раздел, а рассказ о
              проекте — логотип, философия, манифест (Р-61). */}
          <Link to="/about" className={location.pathname.startsWith("/about") ? "active" : ""}>
            О проекте
          </Link>
        </nav>
        <div className="viewer">
          {viewer?.authenticated
            ? (
              <>
                <span title={viewer.permissions.join(", ") || "без прав"}>
                  {viewer.displayName}
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    await supabase.auth.signOut();
                    refresh();
                  }}
                >
                  Выйти
                </button>
              </>
            )
            : <Link to="/login">Войти</Link>}
        </div>
      </header>

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
        <Routes>
          <Route path="/" element={<Catalog canCreate={can("create_delete")} />} />
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
          <Route path="/entities/:id" element={<EntityPage canEdit={can("edit")} />} />
          <Route path="/entities/:id/edit" element={<EntityEditor mode="edit" />} />
          <Route path="/lectures" element={<Lectures canCreate={can("create_delete")} />} />
          <Route path="/media" element={<MediaLibrary canUpload={can("create_delete")} />} />
          <Route path="/parameters" element={<Parameters canManage={can("su")} />} />
          <Route path="/about" element={<About />} />
          <Route path="/about/:section" element={<About />} />
          <Route path="/login" element={<Login onDone={refresh} />} />
          {/* Неизвестный адрес — честное «не найдено», а не переброс на главную:
              сервер отвечает на него 404, и страница говорит то же (Р-65). */}
          <Route path="*" element={<NotFound />} />
        </Routes>
        </ErrorBoundary>
      </main>

      <footer>
        Новый контур. Прежний сайт — <a href="/old/">2vhutemas.ru/old</a>.
      </footer>
    </div>
  );
}
