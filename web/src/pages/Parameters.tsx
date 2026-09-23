/**
 * Справочник параметров и наборов (решение Р-38).
 *
 * Ведёт его не каждый редактор: право `su`. Смысл ограничения в том, что
 * «вместимость зала» и «Вместимость (мест)», заведённые порознь, делают
 * сравнение невозможным — а сравнение и есть цель параметров.
 */
import { useEffect, useState } from "react";
import {
  api,
  type Capabilities,
  type EntityType,
  type ParameterRow,
  type ParameterSetRow,
} from "../api";

const VALUE_TYPES: { code: string; title: string }[] = [
  { code: "number", title: "число" },
  { code: "integer", title: "целое число" },
  { code: "text", title: "текст" },
  { code: "boolean", title: "да или нет" },
  { code: "option", title: "выбор из списка" },
  { code: "date", title: "дата" },
];

export function Parameters({ canManage }: { canManage: boolean }) {
  const [items, setItems] = useState<ParameterRow[]>([]);
  const [sets, setSets] = useState<ParameterSetRow[]>([]);
  const [types, setTypes] = useState<EntityType[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    code: "",
    title_ru: "",
    unit: "",
    value_type: "number",
    definition: "",
  });
  const [setDraftForm, setSetDraft] = useState({ code: "", title_ru: "", note: "" });

  const reload = () => {
    api.parameters().then((result) => setItems(result.items ?? [])).catch((e) =>
      setError(e.message)
    );
    api.parameterSets().then((result) => setSets(result.items ?? [])).catch(() => {});
  };

  useEffect(() => {
    reload();
    api.capabilities().then((caps: Capabilities) => setTypes(caps.entity_types ?? [])).catch(
      () => {},
    );
  }, []);

  const run = async (action: () => Promise<unknown>, done: string) => {
    setError(null);
    setStatus(null);
    try {
      await action();
      setStatus(done);
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section>
      <h1>Параметры</h1>
      <p className="sub">
        Определения величин и наборы для ветвей дерева типов. Один смысл — один параметр.
      </p>

      {error && <p className="error">{error}</p>}
      {status && <p className="notice">{status}</p>}

      <h2>Справочник</h2>
      <table className="grid-table">
        <thead>
          <tr>
            <th>Название</th>
            <th>Код</th>
            <th>Тип значения</th>
            <th>Единица</th>
            <th>Заполнено</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>
                {item.title_ru}
                {item.definition && <div className="hint">{item.definition}</div>}
              </td>
              <td><code>{item.code}</code></td>
              <td>{VALUE_TYPES.find((t) => t.code === item.value_type)?.title ?? item.value_type}</td>
              <td>{item.unit ?? "—"}</td>
              <td>{String(item.used)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {canManage && (
        <>
          <h3>Новый параметр</h3>
          <div className="form">
            <div className="row">
              <label>
                Название
                <input
                  value={draft.title_ru}
                  onChange={(e) => setDraft({ ...draft, title_ru: e.target.value })}
                />
              </label>
              <label>
                Код
                <input
                  value={draft.code}
                  placeholder="hall_capacity"
                  onChange={(e) => setDraft({ ...draft, code: e.target.value })}
                />
              </label>
              <label>
                Тип значения
                <select
                  value={draft.value_type}
                  onChange={(e) => setDraft({ ...draft, value_type: e.target.value })}
                >
                  {VALUE_TYPES.map((t) => <option key={t.code} value={t.code}>{t.title}</option>)}
                </select>
              </label>
              <label>
                Единица измерения
                <input
                  value={draft.unit}
                  placeholder="мест, м, м²"
                  onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
                />
              </label>
            </div>
            <label>
              Что именно считается этой величиной
              <input
                value={draft.definition}
                placeholder="Только зрительный зал, без балконов и приставных мест"
                onChange={(e) => setDraft({ ...draft, definition: e.target.value })}
              />
            </label>
            <button
              type="button"
              onClick={() =>
                run(
                  () =>
                    api.createParameter({
                      code: draft.code.trim(),
                      title_ru: draft.title_ru.trim(),
                      unit: draft.unit.trim() || null,
                      value_type: draft.value_type,
                      definition: draft.definition.trim() || null,
                      sort_order: items.length * 10 + 10,
                    }),
                  "Параметр заведён",
                )}
            >
              Завести параметр
            </button>
          </div>
        </>
      )}

      <h2>Наборы</h2>
      {sets.map((set) => (
        <div className="block" key={set.id}>
          <h3>{set.title_ru} <code>{set.code}</code></h3>
          {set.note && <p className="hint">{set.note}</p>}
          <p>
            Ветви: {set.types.length === 0
              ? "не привязан"
              : set.types.map((t) => t.title).join(", ")}
          </p>
          <ol className="set-items">
            {set.items.map((item) => (
              <li key={item.code}>
                {item.title_ru}
                {item.unit ? `, ${item.unit}` : ""} <code>{item.code}</code>
              </li>
            ))}
          </ol>
          {canManage && (
            <div className="row">
              <SetComposer
                set={set}
                parameters={items}
                onSave={(codes) =>
                  run(
                    () => api.setParameterSetItems(set.code, codes.map((code) => ({ parameter: code }))),
                    "Состав набора сохранён",
                  )}
              />
              <label>
                Привязать к ветви
                <select
                  value=""
                  onChange={(e) =>
                    e.target.value &&
                    run(
                      () => api.attachParameterSet(set.code, e.target.value),
                      "Набор привязан к ветви",
                    )}
                >
                  <option value="">выберите тип</option>
                  {types.map((t) => (
                    <option key={t.code} value={t.code}>
                      {"  ".repeat(t.depth) + (t.depth > 0 ? "– " : "") + t.title_ru}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>
      ))}

      {canManage && (
        <>
          <h3>Новый набор</h3>
          <div className="form">
            <div className="row">
              <label>
                Название
                <input
                  value={setDraftForm.title_ru}
                  placeholder="Зрелищное здание"
                  onChange={(e) => setSetDraft({ ...setDraftForm, title_ru: e.target.value })}
                />
              </label>
              <label>
                Код
                <input
                  value={setDraftForm.code}
                  placeholder="performance_building"
                  onChange={(e) => setSetDraft({ ...setDraftForm, code: e.target.value })}
                />
              </label>
            </div>
            <button
              type="button"
              onClick={() =>
                run(
                  () =>
                    api.createParameterSet({
                      code: setDraftForm.code.trim(),
                      title_ru: setDraftForm.title_ru.trim(),
                      note: setDraftForm.note.trim() || null,
                    }),
                  "Набор заведён",
                )}
            >
              Завести набор
            </button>
          </div>
        </>
      )}
    </section>
  );
}

/** Состав набора: отмеченные параметры в порядке отметки. */
function SetComposer(
  { set, parameters, onSave }: {
    set: ParameterSetRow;
    parameters: ParameterRow[];
    onSave: (codes: string[]) => void;
  },
) {
  const [chosen, setChosen] = useState<string[]>(set.items.map((item) => item.code));
  const toggle = (code: string) =>
    setChosen(chosen.includes(code) ? chosen.filter((c) => c !== code) : [...chosen, code]);

  return (
    <div>
      <div className="hint">Состав набора</div>
      <div className="chips">
        {parameters.map((parameter) => (
          <label className="chip" key={parameter.id}>
            <input
              type="checkbox"
              checked={chosen.includes(parameter.code)}
              onChange={() => toggle(parameter.code)}
            />
            {parameter.title_ru}
          </label>
        ))}
      </div>
      <button type="button" className="ghost" onClick={() => onSave(chosen)}>
        Сохранить состав
      </button>
    </div>
  );
}
