/**
 * Каталог записей: поиск, отбор по ветви дерева типов, переход к карточке.
 *
 * Одна и та же страница служит и общим каталогом, и разделами меню: «Проекты»
 * — это ветвь «Что» (Р-64), «Авторы» — ветвь «Кто». Отдельных механизмов для них не
 * заводим, меняется только начальная ветвь и заголовок (Р-37).
 *
 * Все фильтры живут в адресе страницы (2026-10-17: «сбросить ссылку на
 * страницу с выборкой»): тип, поиск, величина и её границы, порядок и отбор
 * по параметрам-выборам (?opt=competition_state:open,jury).
 */
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ListCount } from "../ui/ListCount";
import { EntityTile } from "../ui/EntityTile";
import {
  api,
  type Capabilities,
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
let initialCatalog: {
  branch: string;
  page: { items: EntityListItem[]; next_cursor: string | null };
  chips?: { code: string; title_ru: string }[];
} | null =
  (() => {
    try {
      const node = document.getElementById("catalog-initial");
      return node?.textContent ? JSON.parse(node.textContent) : null;
    } catch {
      return null;
    }
  })();

/**
 * Готовые группы вариантов для отбора: «активные» и «завершённые» конкурсы
 * (2026-10-17). Остальные параметры-выборы отбираются по одному варианту.
 */
const OPTION_GROUPS: Record<string, { label: string; codes: string[] }[]> = {
  competition_state: [
    { label: "Активные", codes: ["announced", "open", "jury"] },
    { label: "Завершённые", codes: ["results", "cancelled"] },
  ],
};

function takeInitial(branch: string) {
  const found = initialCatalog && initialCatalog.branch === branch ? initialCatalog : null;
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
  const [search, setSearch] = useSearchParams();
  // Адрес с фильтрами — первая страница сервера (без фильтров) не подходит.
  const filtered = [...search.keys()].length > 0;
  const [initial] = useState(() => (filtered ? null : takeInitial(branch ?? "")));
  const [items, setItems] = useState<EntityListItem[]>(initial?.page.items ?? []);
  // Каталог отдаётся страницами; без этого записи за первой страницей
  // были не видны вовсе.
  const [cursor, setCursor] = useState<string | null>(initial?.page.next_cursor ?? null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [types, setTypes] = useState<EntityType[]>([]);
  const [hiddenRoots, setHiddenRoots] = useState<string[]>([]);
  const [groupsByBranch, setGroupsByBranch] = useState<Capabilities["catalog_groups"]>({});
  const [parameters, setParameters] = useState<SuggestedParameter[]>([]);
  const [optionParameters, setOptionParameters] = useState<SuggestedParameter[]>([]);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Состояние фильтров — из адреса; правка фильтра правит адрес.
  const type = search.get("type") ?? branch ?? "";
  const group = search.get("g") ?? "";
  const query = search.get("q") ?? "";
  const parameter = search.get("by") ?? "";
  const min = search.get("min") ?? "";
  const max = search.get("max") ?? "";
  const descending = search.get("order") === "desc";
  const opt = search.getAll("opt");
  const optKey = opt.join("|");
  const update = (changes: Record<string, string | string[] | null>) => {
    const next = new URLSearchParams(search);
    for (const [key, value] of Object.entries(changes)) {
      next.delete(key);
      for (const item of Array.isArray(value) ? value : value ? [value] : []) next.append(key, item);
    }
    // Раздел меню сам задаёт ветвь — её в адрес не пишем.
    if (next.get("type") === (branch ?? "")) next.delete("type");
    setSearch(next, { replace: true });
    setCopied(false);
  };
  // Смена типа сбрасывает величину и отбор по выбору: у другого типа они свои.
  const setType = (code: string) => update({ type: code, by: null, min: null, max: null, order: null, opt: null });
  const setGroup = (code: string) =>
    update({ g: code, type: null, by: null, min: null, max: null, order: null, opt: null });
  const setQuery = (value: string) => update({ q: value });
  const setParameter = (value: string) => update({ by: value, min: null, max: null });
  const setMin = (value: string) => update({ min: value });
  const setMax = (value: string) => update({ max: value });
  const setDescending = (value: boolean) => update({ order: value ? "desc" : null });
  const optionValue = (code: string) => opt.find((item) => item.startsWith(code + ":"))?.slice(code.length + 1) ?? "";
  const setOption = (code: string, value: string) =>
    update({ opt: [...opt.filter((item) => !item.startsWith(code + ":")), ...(value ? [`${code}:${value}`] : [])] });
  const copyLink = () => {
    navigator.clipboard.writeText(location.href).then(() => setCopied(true)).catch(() => {});
  };

  useEffect(() => {
    api.capabilities()
      .then((caps: Capabilities) => {
        setTypes(caps.entity_types ?? []);
        setHiddenRoots(caps.catalog_hidden_roots ?? []);
        setGroupsByBranch(caps.catalog_groups ?? {});
      })
      .catch(() => setTypes([]));
  }, []);

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
  // Те же кнопки, что рисует сервер (pages.ts, typeChips): дети ветви или корни
  // дерева без скрытых ветвей — правило одно, приходит в capabilities.
  // Пока список типов не пришёл, держим кнопки, вложенные сервером: без мигания.
  const directChips = branch
    ? types.filter((item) => item.parent === branch)
    : types.filter((item) => item.depth === 0 && !hiddenRoots.includes(item.code));
  // Двухуровневый отбор (2026-10-17): в разделе с группами первый ряд —
  // группы, второй — типы выбранной группы. Тип вне групп — в «Прочее».
  const configured = (branch && groupsByBranch?.[branch]) || [];
  const grouped = new Set(configured.flatMap((g) => g.types));
  const rest = directChips.filter((t) => !grouped.has(t.code)).map((t) => t.code);
  const groups = configured.length && rest.length
    ? [...configured, { code: "other", title_ru: "Прочее", types: rest }]
    : configured;
  const activeGroup = groups.find((g) => g.code === group) ?? null;
  const titleOf = (code: string) => types.find((t) => t.code === code)?.title_ru ?? code;
  const firstRow = types.length === 0 ? (initial?.chips ?? []) : groups.length
    ? groups.map((g) => ({ code: g.code, title_ru: g.title_ru }))
    : directChips;
  // Что спросить у API: выбранный тип, иначе все типы группы, иначе ветвь.
  const apiType = (search.get("type") ? type : activeGroup?.types.join(",")) || type || undefined;

  // Сортировать можно по числовым величинам выбранной ветви: ради этого
  // параметры и заведены (Р-38).
  // Отбор по выбору — параметры-выборы типа: у конкурса «Состояние»,
  // «Формат», «Для кого».
  useEffect(() => {
    if (!type) {
      setParameters([]);
      setOptionParameters([]);
      return;
    }
    api.parametersForType(type)
      .then((result) => {
        const items = result.items ?? [];
        setParameters(items.filter((item) => item.value_type === "number" || item.value_type === "integer"));
        setOptionParameters(items.filter((item) => item.value_type === "option" && item.options.length > 0));
      })
      .catch(() => {
        setParameters([]);
        setOptionParameters([]);
      });
  }, [type]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      api.entities({
        type: apiType,
        q: query || undefined,
        parameter: parameter || undefined,
        min: min || undefined,
        max: max || undefined,
        sort: parameter ? "parameter" : undefined,
        order: descending ? "desc" : "asc",
        opt,
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
  }, [apiType, query, parameter, min, max, descending, optKey]);

  const loadMore = () => {
    if (!cursor) return;
    setLoadingMore(true);
    api.entities({
      type: apiType,
      q: query || undefined,
      parameter: parameter || undefined,
      min: min || undefined,
      max: max || undefined,
      sort: parameter ? "parameter" : undefined,
      order: descending ? "desc" : "asc",
      opt,
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
      <div className="catalog-head">
        <h1>{title ?? "Всё"}</h1>
        <p className="sub">
          {sub ?? "Все записи подряд: объекты, авторы, периоды и служебные материалы."}
        </p>
      </div>

      {/* Первый ряд — группы раздела (или ближайшие ветви, если групп нет);
          второй — типы выбранной группы (Р-91, 2026-10-17). */}
      <div className="type-chips" role="group" aria-label={groups.length ? "Группа" : "Тип записи"}>
        {[{ code: "", title_ru: branch ? "Все в разделе" : "Все" }, ...firstRow].map((chip) => {
          const on = groups.length || (types.length === 0 && initial?.chips?.length)
            ? group === chip.code && (chip.code !== "" || !search.get("type"))
            : (chip.code ? type === chip.code : type === (branch ?? ""));
          return (
            <button
              key={chip.code || "all"}
              type="button"
              className={on ? "on" : undefined}
              aria-pressed={!!on}
              onClick={() => (groups.length ? setGroup(chip.code) : setType(chip.code || (branch ?? "")))}
            >
              {chip.title_ru}
            </button>
          );
        })}
      </div>
      {activeGroup && (
        <div className="type-chips sub" role="group" aria-label="Тип записи">
          {[{ code: "", title_ru: "Вся группа" }, ...activeGroup.types.map((code) => ({ code, title_ru: titleOf(code) }))]
            .map((chip) => {
              const on = chip.code ? search.get("type") === chip.code : !search.get("type");
              return (
                <button key={chip.code || "all"} type="button" className={on ? "on" : undefined} aria-pressed={on}
                  onClick={() => (chip.code ? setType(chip.code) : update({ type: null, by: null, min: null, max: null, order: null, opt: null }))}>
                  {chip.title_ru}
                </button>
              );
            })}
        </div>
      )}

      <div className="filters">
        <input
          placeholder="Поиск по названию"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {/* Глубже кнопок — список всех типов раздела (только там, где групп нет). */}
        {!groups.length && (
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value={branch ?? ""}>{branch ? "Все в разделе" : "Все типы"}</option>
            {shown.filter((t) => t.code !== branch).map((t) => (
              <option key={t.code} value={t.code}>
                {"  ".repeat(Math.max(t.depth - depthShift, 0)) +
                  (t.depth - depthShift > 0 ? "– " : "") + t.title_ru}
              </option>
            ))}
          </select>
        )}
        {optionParameters.map((item) => {
          const value = optionValue(item.parameter);
          const groups = OPTION_GROUPS[item.parameter] ?? [];
          return (
            <select key={item.parameter} value={value} title={item.title}
              onChange={(e) => setOption(item.parameter, e.target.value)}>
              <option value="">{item.title}: все</option>
              {groups.map((g) => <option key={g.label} value={g.codes.join(",")}>{g.label}</option>)}
              {item.options.map((o) => <option key={o.code} value={o.code}>{o.title}</option>)}
            </select>
          );
        })}
        {filtered && (
          <>
            <button type="button" className="ghost" onClick={copyLink} title="Ссылка на эту выборку">
              {copied ? "Ссылка скопирована" : "Скопировать ссылку"}
            </button>
            <button type="button" className="ghost" onClick={() => { setSearch(new URLSearchParams(), { replace: true }); setCopied(false); }}>
              Сбросить фильтры
            </button>
          </>
        )}
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

      <div className="grid catalog-grid">
        {items.map((item, index) => (
          <EntityTile
            key={item.id}
            href={`/entities/${item.slug}`}
            title={item.title_ru}
            kind={item.type_title ?? item.type}
            compact={item.compact}
            large={index === 0}
          >
            {parameter && item.parameter_value !== null &&
              item.parameter_value !== undefined && (
              <div className="badge">
                {String(item.parameter_value)}
                {parameters.find((p) => p.parameter === parameter)?.unit ?? ""}
              </div>
            )}
            {item.title_en && <div className="kind">{item.title_en}</div>}
            <div style={{ marginTop: 8 }}>
              <span className={item.material_status === "published" ? "badge status" : "badge status draft"}>
                {item.material_status === "published" ? "опубликовано" : "черновик"}
              </span>
            </div>
          </EntityTile>
        ))}
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
