/**
 * Лекции: записи ветви «Служебные» по порядку номеров (решение Р-44).
 *
 * Отдельного механизма здесь нет — тот же каталог, отобранный по ветви
 * дерева и отсортированный по величине «Номер лекции». Записи без номера
 * не прячутся, а уходят в конец: пустое остаётся пустым, но не исчезает.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type EntityListItem } from "../api";

export function Lectures({ canCreate }: { canCreate: boolean }) {
  const [items, setItems] = useState<EntityListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.entities({
      type: "service",
      parameter: "lecture_number",
      sort: "parameter",
      order: "asc",
      values: "lecture_number,course",
    })
      .then((page) => {
        setItems(page.items);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <section>
      <h1>Лекции</h1>
      <p className="sub">Материалы курса по порядку номеров.</p>

      {error && <p className="error">{error}</p>}
      {loading && <p className="notice">Загружаем…</p>}
      {!loading && !error && items.length === 0 && (
        <p className="notice">
          Лекций пока нет.{" "}
          {canCreate && "Нажмите «Создать лекцию» — тип подставится сам."}
        </p>
      )}

      {items.length > 0 && (
        <table className="grid-table">
          <thead>
            <tr>
              <th style={{ width: 60 }}>№</th>
              <th>Название</th>
              <th style={{ width: 200 }}>Курс</th>
              <th style={{ width: 140 }}>Состояние</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.values?.lecture_number ?? "—"}</td>
                <td>
                  <Link to={`/entities/${item.id}`}>{item.title_ru}</Link>
                  {item.type !== "lecture" && (
                    <span className="hint">{item.type_title ?? item.type}</span>
                  )}
                </td>
                <td>{item.values?.course ?? "—"}</td>
                <td>
                  <span className="badge">
                    {item.material_status === "published" ? "опубликовано" : "черновик"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {canCreate && (
        <Link to="/entities/new?type=lecture">
          <button type="button">Создать лекцию</button>
        </Link>
      )}
    </section>
  );
}
