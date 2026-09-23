/** Каталог записей: поиск, отбор по ветви дерева типов, переход к карточке. */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Capabilities, type EntityListItem, type EntityType } from "../api";

export function Catalog({ canCreate }: { canCreate: boolean }) {
  const [items, setItems] = useState<EntityListItem[]>([]);
  const [types, setTypes] = useState<EntityType[]>([]);
  const [type, setType] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.capabilities()
      .then((caps: Capabilities) => setTypes(caps.entity_types ?? []))
      .catch(() => setTypes([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      api.entities({ type: type || undefined, q: query || undefined })
        .then((page) => {
          if (!cancelled) {
            setItems(page.items);
            setError(null);
          }
        })
        .catch((e) => !cancelled && setError(e.message))
        .finally(() => !cancelled && setLoading(false));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [type, query]);

  return (
    <section>
      <h1>Каталог</h1>
      <p className="sub">Объекты, авторы и периоды нового контура.</p>

      <div className="filters">
        <input
          placeholder="Поиск по названию"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Все типы</option>
          {types.map((t) => (
            <option key={t.code} value={t.code}>
              {"  ".repeat(t.depth) + (t.depth > 0 ? "– " : "") + t.title_ru}
            </option>
          ))}
        </select>
        {canCreate && <Link to="/entities/new"><button type="button">Создать объект</button></Link>}
      </div>

      {error && <p className="error">{error}</p>}
      {loading && <p className="notice">Загружаем…</p>}
      {!loading && !error && items.length === 0 && (
        <p className="notice">
          Пока ничего нет. {canCreate ? "Создайте первый объект." : "Материалы появятся позже."}
        </p>
      )}

      <div className="grid">
        {items.map((item) => (
          <Link className="card" key={item.id} to={`/entities/${item.id}`}>
            {item.cover_asset_id
              ? (
                <img
                  src={api.mediaFileUrl(item.cover_asset_id, "thumbnail")}
                  alt=""
                  loading="lazy"
                />
              )
              : <div className="card-no-cover">без изображения</div>}
            <div className="kind">{item.type_title ?? item.type}</div>
            <div className="title">{item.title_ru}</div>
            {item.title_en && <div className="kind">{item.title_en}</div>}
            <div style={{ marginTop: 8 }}>
              <span className="badge">
                {item.material_status === "published" ? "опубликовано" : "черновик"}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
