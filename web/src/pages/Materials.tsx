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

export function Materials({ allowed }: { allowed: boolean }) {
  const [items, setItems] = useState<MaterialFolderRow[]>([]);
  const [filter, setFilter] = useState("");
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
  const shown = q ? items.filter((it) => (it.path + " " + it.title_ru).toLowerCase().includes(q)) : items;
  const withFiles = items.filter((it) => it.files > 0).length;

  return (
    <section>
      <h1>Материалы в работе</h1>
      <p className="sub">
        Папки Dropbox <code>2VHUTEMAS</code>: <code>ЧТО/ПРОЕКТЫ</code> и <code>КТО/ЛЮДИ</code>, папка записи —
        «тип_название». Материалы не публикуются; опись видят только редакторы на странице записи.
      </p>
      {error && <p className="error">{error}</p>}
      {result && (
        <p className="notice">
          Новых папок: {result.created}, сопоставлено вручную положенных: {result.linked},
          файлов в описи: {result.files}.
          {result.unmatched.length > 0 && <> Не сопоставлены: {result.unmatched.join(", ")}.</>}
        </p>
      )}
      <div className="filters">
        <button type="button" disabled={busy} onClick={refresh}>
          {busy ? "Обновляем…" : "Обновить файловую структуру"}
        </button>
        <input type="search" placeholder="Папка или запись" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <span className="hint">Папок: {items.length}, с файлами: {withFiles}</span>
      </div>
      <div className="table-scroll">
        <table className="value-table">
          <thead>
            <tr><th>Папка</th><th>Запись</th><th className="num">Файлов</th><th>Опись</th></tr>
          </thead>
          <tbody>
            {shown.map((it) => (
              <tr key={it.entity_id}>
                <td><code>{it.path}</code></td>
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
