/**
 * Каталог записей: поиск, отбор по ветви дерева типов, переход к карточке.
 *
 * Одна и та же страница служит и общим каталогом, и разделами меню: «Проекты»
 * — это ветвь «Что» (Р-64), «Авторы» — ветвь «Кто». Отдельных механизмов для них не
 * заводим, меняется только начальная ветвь и заголовок (Р-37).
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ListCount } from "../ui/ListCount";
import { SourceMark } from "../editor/entityBlocks";
import {
  api,
  type Capabilities,
  compactParts,
  compactPicture,
  type EntityListItem,
  type EntityType,
  type SuggestedParameter,
} from "../api";

/**
 * Первая страница каталога, вложенная сервером в готовую страницу: тот же
 * ответ API, что каталог запросил бы сам. Начинаем с неё — и при загрузке
 * клиента сетка не исчезает за «Загружаем…» и не перестраивается.
 * Читается один раз: при переходах внутри приложения её уже нет.
 */
let initialCatalog: { branch: string; page: { items: EntityListItem[]; next_cursor: string | null } } | null =
  (() => {
    try {
      const node = document.getElementById("catalog-initial");
      return node?.textContent ? JSON.parse(node.textContent) : null;
    } catch {
      return null;
    }
  })();

function takeInitial(branch: string) {
  const found = initialCatalog && initialCatalog.branch === branch ? initialCatalog.page : null;
  initialCatalog = null;
  return found;
}

interface Props {
  canCreate: boolean;
  /** Ветвь дерева, которой ограничен раздел; пусто — весь каталог. */
  branch?: string;
  title?: string;
  sub?: string;
}

export function Catalog({ canCreate, branch, title, sub }: Props) {
  const [initial] = useState(() => takeInitial(branch ?? ""));
  const [items, setItems] = useState<EntityListItem[]>(initial?.items ?? []);
  // Каталог отдаётся страницами; без этого записи за первой страницей
  // были не видны вовсе.
  const [cursor, setCursor] = useState<string | null>(initial?.next_cursor ?? null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [types, setTypes] = useState<EntityType[]>([]);
  const [type, setType] = useState(branch ?? "");
  const [query, setQuery] = useState("");
  const [parameters, setParameters] = useState<SuggestedParameter[]>([]);
  const [parameter, setParameter] = useState("");
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [descending, setDescending] = useState(false);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.capabilities()
      .then((caps: Capabilities) => setTypes(caps.entity_types ?? []))
      .catch(() => setTypes([]));
  }, []);

  useEffect(() => {
    setType(branch ?? "");
    setQuery("");
  }, [branch]);

  /** В разделе показываем только его ветвь: остальное дерево здесь лишнее. */
  const inBranch = (code: string): boolean => {
    if (!branch) return true;
    let current: EntityType | undefined = types.find((item) => item.code === code);
    while (current) {
      if (current.code === branch) return true;
      current = types.find((item) => item.code === current?.parent);
    }
    return false;
  };
  const shown = types.filter((item) => inBranch(item.code));
  const depthShift = branch ? (types.find((item) => item.code === branch)?.depth ?? 0) : 0;

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
            setCursor(page.next_cursor);
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

  const loadMore = () => {
    if (!cursor) return;
    setLoadingMore(true);
    api.entities({
      type: type || undefined,
      q: query || undefined,
      parameter: parameter || undefined,
      min: min || undefined,
      max: max || undefined,
      sort: parameter ? "parameter" : undefined,
      order: descending ? "desc" : "asc",
      cursor,
    })
      .then((page) => {
        setItems((current) => [...current, ...page.items]);
        setCursor(page.next_cursor);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoadingMore(false));
  };

  return (
    <section>
      <h1>{title ?? "Всё"}</h1>
      <p className="sub">
        {sub ?? "Все записи подряд: объекты, авторы, периоды и служебные материалы."}
      </p>

      <div className="filters">
        <input
          placeholder="Поиск по названию"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value={branch ?? ""}>{branch ? "Все в разделе" : "Все типы"}</option>
          {shown.filter((t) => t.code !== branch).map((t) => (
            <option key={t.code} value={t.code}>
              {"  ".repeat(Math.max(t.depth - depthShift, 0)) +
                (t.depth - depthShift > 0 ? "– " : "") + t.title_ru}
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
      {loading && items.length === 0 && <p className="notice">Загружаем…</p>}
      {!loading && !error && items.length === 0 && (
        <p className="notice">
          Пока ничего нет. {canCreate ? "Создайте первый объект." : "Материалы появятся позже."}
        </p>
      )}

      <ListCount
        shown={items.length}
        word={["запись", "записи", "записей"]}
        hasMore={!!cursor}
        onMore={loadMore}
        loading={loadingMore}
      />

      <div className="grid">
        {items.map((item) => {
          // Что показать, решает компактный вид типа (таблица отображений):
          // миниатюра или портрет, знак источника, значения параметров.
          const view = compactParts(item.compact);
          return (
          <a
            className={view.portrait ? "card portrait" : "card"}
            key={item.id}
            href={`/entities/${item.slug}`}
          >
            {view.picture && (compactPicture(view, "thumbnail")
              ? (
                <img
                  src={compactPicture(view, "thumbnail")!}
                  alt=""
                  loading="lazy"
                />
              )
              : <div className="card-no-cover">без изображения</div>)}
            <div className="kind">{item.type_title ?? item.type}</div>
            <div className="title">{view.mark && <SourceMark />}{item.title_ru}</div>
            {view.params.length > 0 && <div className="kind">{view.params.join(", ")}</div>}
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
          </a>
          );
        })}
      </div>

      {items.length > 0 && (
        <ListCount
          shown={items.length}
          word={["запись", "записи", "записей"]}
          hasMore={!!cursor}
          onMore={loadMore}
          loading={loadingMore}
        />
      )}
    </section>
  );
}
