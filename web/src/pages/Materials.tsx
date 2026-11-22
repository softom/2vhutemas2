/**
 * Материалы в работе: таблица соответствия «папка Dropbox — запись» (0051, 0052).
 *
 * Решение пользователя 2026-10-15: материалы складываются в Dropbox, в папку
 * 2VHUTEMAS (ЧТО/ПРОЕКТЫ, КТО/ЛЮДИ). Кнопка «Обновить файловую структуру»
 * досоздаёт папки новым записям, сопоставляет положенные вручную и снимает
 * опись. Страница — только для su.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type MaterialFolderRow, type MaterialsRefreshResult } from "../api";

/** Ссылки на папку: Проводник (обработчик tools/install_folder_links.py) и веб-Dropbox. */
const segs = (path: string) => path.split("/").map(encodeURIComponent).join("/");
const explorerHref = (path: string) => `vhutemas-folder:${segs(path)}`;
const dropboxHref = (path: string) => `https://www.dropbox.com/home/2VHUTEMAS/${segs(path)}`;
/** Путь Windows для адресной строки Проводника (корень — как у Dropbox на компьютере редакции). */
const windowsPath = (path: string) => "E:\\Dropbox\\2VHUTEMAS\\" + path.replaceAll("/", "\\");

export function Materials({ allowed }: { allowed: boolean }) {
  const [items, setItems] = useState<MaterialFolderRow[]>([]);
  const [filter, setFilter] = useState("");
  const [copied, setCopied] = useState<number | null>(null);
  const [root, setRoot] = useState("");
  const [type, setType] = useState("");
  const [withFilesOnly, setWithFilesOnly] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MaterialsRefreshResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = () => {
    api.materialFolders().then((r) => setItems(r.items ?? [])).catch((e) => setError((e as Error).message));
  };
  useEffect(() => { if (allowed) reload(); }, [allowed]);

  if (!allowed) return <p className="error">Недостаточно прав.</p>;

  const refresh = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.refreshMaterials());
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const q = filter.trim().toLowerCase();
  // Фильтры: раздел, тип записи, есть ли файлы, текст — по названию (русскому
  // и английскому) и по пути папки.
  const types = [...new Map(items.filter((it) => !root || it.root === root)
    .map((it) => [it.type, it.type_title])).entries()].sort((a, b) => a[1].localeCompare(b[1], "ru"));
  const shown = items.filter((it) =>
    (!root || it.root === root) && (!type || it.type === type) &&
    (!withFilesOnly || (withFilesOnly === "yes" ? it.files > 0 : it.files === 0)) &&
    (!q || `${it.title_ru} ${it.title_en ?? ""} ${it.path}`.toLowerCase().includes(q)));
  const withFiles = items.filter((it) => it.files > 0).length;

  return (
    <section>
      <h1>Материалы в работе</h1>
      <p className="sub">
        Папки Dropbox <code>2VHUTEMAS</code>: <code>ЧТО/ПРОЕКТЫ</code> и <code>КТО/ЛЮДИ</code>, папка записи —
        «тип_название (English)». Материалы не публикуются; опись видят только редакторы на странице записи.
        Путь папки открывает её в Проводнике — один раз на компьютере: <code>python tools/install_folder_links.py</code>.
      </p>
      {error && <p className="error">{error}</p>}
      {result && (
        <p className="notice">
          Новых папок: {result.created}, сопоставлено: {result.linked}, переименовано: {result.renamed},
          файлов в описи: {result.files}.
          {result.unmatched.length > 0 && <> Не сопоставлены: {result.unmatched.join(", ")}.</>}
        </p>
      )}
      <div className="filters">
        <button type="button" disabled={busy} onClick={refresh}>
          {busy ? "Обновляем…" : "Обновить файловую структуру"}
        </button>
        <input type="search" placeholder="Название записи или папки" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <select value={root} onChange={(e) => { setRoot(e.target.value); setType(""); }}>
          <option value="">Все разделы</option>
          <option value="what">ЧТО / ПРОЕКТЫ</option>
          <option value="who">КТО / ЛЮДИ</option>
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Все типы</option>
          {types.map(([code, title]) => <option key={code} value={code}>{title}</option>)}
        </select>
        <select value={withFilesOnly} onChange={(e) => setWithFilesOnly(e.target.value)}>
          <option value="">С файлами и пустые</option>
          <option value="yes">Только с файлами</option>
          <option value="no">Только пустые</option>
        </select>
        <span className="hint">Показано: {shown.length} из {items.length}, с файлами: {withFiles}</span>
      </div>
      <div className="table-scroll">
        <table className="value-table">
          <thead>
            <tr><th>Папка</th><th>Запись</th><th className="num">Файлов</th><th>Опись</th></tr>
          </thead>
          <tbody>
            {shown.map((it) => (
              <tr key={it.entity_id}>
                <td>
                  <a href={explorerHref(it.path)} title="Открыть в Проводнике"><code>{it.path}</code></a>
                  {" "}<button type="button" className="ghost" title={`Скопировать путь: ${windowsPath(it.path)}`}
                    onClick={() => navigator.clipboard.writeText(windowsPath(it.path)).then(() => setCopied(it.entity_id))}>
                    {copied === it.entity_id ? "скопировано" : "копировать путь"}
                  </button>
                  {" "}<a className="hint" href={dropboxHref(it.path)} target="_blank" rel="noreferrer" title="Открыть в веб-Dropbox">Dropbox ↗</a>
                </td>
                <td><Link to={`/entities/${it.slug ?? it.entity_id}`}>{it.title_ru}</Link></td>
                <td className="num">{it.files || ""}</td>
                <td>{it.synced_at ? new Date(it.synced_at).toLocaleString("ru-RU") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
