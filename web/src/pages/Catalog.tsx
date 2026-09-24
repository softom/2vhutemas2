/** Каталог записей: поиск, отбор по ветви дерева типов, переход к карточке. */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  api,
  type Capabilities,
  type EntityListItem,
  type EntityType,
  type SuggestedParameter,
} from "../api";

export function Catalog({ canCreate }: { canCreate: boolean }) {
  const [items, setItems] = useState<EntityListItem[]>([]);
  const [types, setTypes] = useState<EntityType[]>([]);
  const [type, setType] = useState("");
  const [query, setQuery] = useState("");
  const [parameters, setParameters] = useState<SuggestedParameter[]>([]);
  const [parameter, setParameter] = useState("");
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [descending, setDescending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.capabilities()
      .then((caps: Capabilities) => setTypes(caps.entity_types ?? []))
      .catch(() => setTypes([]));
  }, []);

  // Сортировать можно по числовым величинам выбранной ветви: ради этого
  // параметры и заведены (Р-38).
  useEffect(() => {
    setParameter("");
    if (!type) {
      setParameters([]);
      return;
    }
    api.parametersForType(type)
      .then((result) =>
        setParameters(
          (result.items ?? []).filter((item) =>
            item.value_type === "number" || item.value_type === "integer"
          ),
        )
      )
      .catch(() => setParameters([]));
  }, [type]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      api.entities({
        type: type || undefined,
        q: query || undefined,
        parameter: parameter || undefined,
        min: min || undefined,
        max: max || undefined,
        sort: parameter ? "parameter" : undefined,
        order: descending ? "desc" : "asc",
      })
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
  }, [type, query, parameter, min, max, descending]);

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
        {canCreate && (
          <Link to={type ? `/entities/new?type=${type}` : "/entities/new"}>
            <button type="button">Создать запись</button>
          </Link>
        )}
      </div>

      {parameters.length > 0 && (
        <div className="filters">
          <select value={parameter} onChange={(e) => setParameter(e.target.value)}>
            <option value="">Без сортировки по величине</option>
            {parameters.map((item) => (
              <option key={item.parameter} value={item.parameter}>
                {item.unit ? `${item.title}, ${item.unit}` : item.title}
              </option>
            ))}
          </select>
          {parameter && (
            <>
              <input
                placeholder="от"
                inputMode="numeric"
                value={min}
                onChange={(e) => setMin(e.target.value)}
              />
              <input
                placeholder="до"
                inputMode="numeric"
                value={max}
                onChange={(e) => setMax(e.target.value)}
              />
              <button type="button" className="ghost" onClick={() => setDescending(!descending)}>
                {descending ? "по убыванию" : "по возрастанию"}
              </button>
            </>
          )}
        </div>
      )}

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
            {parameter && item.parameter_value !== null &&
              item.parameter_value !== undefined && (
              <div className="badge">
                {String(item.parameter_value)}
                {parameters.find((p) => p.parameter === parameter)?.unit ?? ""}
              </div>
            )}
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
