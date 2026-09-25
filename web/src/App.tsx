/**
 * Каркас интерфейса нового контура: навигация, вход и экраны этапа 1.
 * Интерфейс на русском, отдельного слоя перевода нет (решение Р-18).
 */
import { useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { api, supabase } from "./api";
import { Catalog } from "./pages/Catalog";
import { EntityPage } from "./pages/EntityPage";
import { EntityEditor } from "./pages/EntityEditor";
import { Lectures } from "./pages/Lectures";
import { MediaLibrary } from "./pages/MediaLibrary";
import { Parameters } from "./pages/Parameters";
import { Login } from "./pages/Login";
import { ErrorBoundary } from "./ui/ErrorBoundary";

export interface Viewer {
  authenticated: boolean;
  displayName: string;
  permissions: string[];
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
  const location = useLocation();

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
        const html = await (await fetch("/new/", { cache: "no-store" })).text();
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

  const can = (permission: string) =>
    viewer?.permissions.includes(permission) || viewer?.permissions.includes("su") || false;

  return (
    <div className="shell">
      <header className="top">
        <Link className="brand" to="/">2vhutemas</Link>
        <nav>
          <Link to="/" className={location.pathname === "/" ? "active" : ""}>Каталог</Link>
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
          <Route path="/entities/new" element={<EntityEditor mode="create" />} />
          <Route path="/entities/:id" element={<EntityPage canEdit={can("edit")} />} />
          <Route path="/entities/:id/edit" element={<EntityEditor mode="edit" />} />
          <Route path="/lectures" element={<Lectures canCreate={can("create_delete")} />} />
          <Route path="/media" element={<MediaLibrary canUpload={can("create_delete")} />} />
          <Route path="/parameters" element={<Parameters canManage={can("su")} />} />
          <Route path="/login" element={<Login onDone={refresh} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </ErrorBoundary>
      </main>

      <footer>
        Новый контур в разработке. Старый сайт работает по прежнему адресу.
      </footer>
    </div>
  );
}
