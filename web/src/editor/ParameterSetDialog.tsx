/**
 * Окно набора параметров: создание и правка (правило 15, решение Р-38).
 *
 * Набор — список величин для ветви дерева типов. Он подсказывает состав,
 * а не ограничивает его, и действует для всего, что ниже выбранной ветви.
 *
 * Окно одно на оба действия: выбирается ветвь, вводится название, и в набор
 * складываются параметры — готовые из справочника или заведённые тут же.
 */
import { useEffect, useState } from "react";
import {
  api,
  type Capabilities,
  type EntityType,
  type ParameterRow,
  type ParameterSetRow,
} from "../api";
import { Modal } from "../ui/Modal";
import { ParameterDialog, VALUE_TYPES } from "./ParameterDialog";

interface Item {
  parameter: string;
  hint: string;
}

interface Props {
  /** Пусто — новый набор. */
  set?: ParameterSetRow | null;
  onSaved: () => void;
  onClose: () => void;
}

/** Код из названия: набор адресуется по нему. */
function codeFrom(title: string): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i",
    й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
    у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "",
    э: "e", ю: "yu", я: "ya", " ": "_", "-": "_",
  };
  return title.toLowerCase().split("").map((ch) => map[ch] ?? ch)
    .join("").replace(/[^a-z0-9_]/g, "").replace(/_+/g, "_").replace(/^_|_$/g, "")
    .slice(0, 40);
}

export function ParameterSetDialog({ set, onSaved, onClose }: Props) {
  const editing = !!set;
  const [types, setTypes] = useState<EntityType[]>([]);
  const [registry, setRegistry] = useState<ParameterRow[]>([]);
  const [title, setTitle] = useState(set?.title_ru ?? "");
  const [code, setCode] = useState(set?.code ?? "");
  const [codeTouched, setCodeTouched] = useState(editing);
  const [note, setNote] = useState(set?.note ?? "");
  const [branches, setBranches] = useState<string[]>((set?.types ?? []).map((t) => t.code));
  const [items, setItems] = useState<Item[]>(
    (set?.items ?? []).map((item) => ({ parameter: item.code, hint: item.hint ?? "" })),
  );
  const [adding, setAdding] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reloadRegistry = () =>
    api.parameters().then((result) => setRegistry(result.items ?? [])).catch(() => {});

  useEffect(() => {
    api.capabilities()
      .then((caps: Capabilities) => setTypes(caps.entity_types ?? []))
      .catch(() => {});
    reloadRegistry();
  }, []);

  const known = (code: string) => registry.find((row) => row.code === code);
  const free = registry.filter((row) => !items.some((item) => item.parameter === row.code));

  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setItems(next);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const setCodeValue = code.trim();
      if (!setCodeValue || !title.trim()) {
        throw new Error("Укажите название набора");
      }
      if (branches.length === 0) {
        throw new Error("Выберите тип записи, для которого этот набор");
      }

      if (editing) {
        await api.updateParameterSet(set!.code, { title_ru: title.trim(), note: note || null });
      } else {
        await api.createParameterSet({
          code: setCodeValue,
          title_ru: title.trim(),
          note: note || null,
        });
      }

      await api.setParameterSetItems(
        editing ? set!.code : setCodeValue,
        items.map((item) => ({ parameter: item.parameter, hint: item.hint || null })),
      );

      const was = (set?.types ?? []).map((t) => t.code);
      for (const branch of branches.filter((b) => !was.includes(b))) {
        await api.attachParameterSet(editing ? set!.code : setCodeValue, branch);
      }
      for (const branch of was.filter((b) => !branches.includes(b))) {
        await api.detachParameterSet(set!.code, branch);
      }

      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={editing ? "Правка набора" : "Новый набор параметров"}
      dirty={title.trim() !== (set?.title_ru ?? "") ||
        items.length !== (set?.items.length ?? 0) ||
        branches.length !== (set?.types.length ?? 0)}
      onClose={onClose}
      footer={
        <>
          <button type="button" disabled={saving} onClick={save}>
            {editing ? "Сохранить" : "Создать"}
          </button>
          <button type="button" className="ghost" onClick={onClose}>Отмена</button>
        </>
      }
    >
      <div className="form">
        {error && <p className="error">{error}</p>}

        <div className="row">
          <label style={{ flex: 2, minWidth: 220 }}>
            Название набора
            <input
              autoFocus
              value={title}
              placeholder="Зрелищное здание"
              onChange={(e) => {
                setTitle(e.target.value);
                if (!codeTouched) setCode(codeFrom(e.target.value));
              }}
            />
          </label>
          <label>
            Код
            <input
              value={code}
              disabled={editing}
              onChange={(e) => {
                setCodeTouched(true);
                setCode(e.target.value);
              }}
            />
          </label>
        </div>

        <label>
          Для какого типа записи
          <select
            value=""
            onChange={(e) => {
              if (e.target.value && !branches.includes(e.target.value)) {
                setBranches([...branches, e.target.value]);
              }
            }}
          >
            <option value="">выберите тип</option>
            {types.filter((type) => !branches.includes(type.code)).map((type) => (
              <option key={type.code} value={type.code}>
                {"  ".repeat(type.depth) + (type.depth > 0 ? "– " : "") +
                  type.title_ru}
              </option>
            ))}
          </select>
          <span className="hint">
            Набор действует и для всего, что ниже выбранной ветви
          </span>
        </label>

        {branches.length > 0 && (
          <div className="chips">
            {branches.map((branch) => (
              <span className="chip" key={branch}>
                {types.find((type) => type.code === branch)?.title_ru ?? branch}
                <button
                  type="button"
                  className="chip-remove"
                  onClick={() => setBranches(branches.filter((b) => b !== branch))}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}

        <label>
          Пояснение к набору
          <input
            value={note}
            placeholder="Величины, по которым сравниваем зрелищные здания"
            onChange={(e) => setNote(e.target.value)}
          />
        </label>

        <div className="value-label">Состав набора</div>
        {items.length === 0 && <p className="notice">Пока пусто. Добавьте величины ниже.</p>}
        <ol className="set-items">
          {items.map((item, index) => {
            const parameter = known(item.parameter);
            return (
              <li key={item.parameter}>
                <div className="row">
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <strong>{parameter?.title_ru ?? item.parameter}</strong>
                    <div className="hint">
                      {VALUE_TYPES.find((t) => t.code === parameter?.value_type)?.title ??
                        parameter?.value_type}
                      {parameter?.unit ? `, ${parameter.unit}` : ""}
                      {parameter?.definition ? ` — ${parameter.definition}` : ""}
                    </div>
                  </div>
                  <button type="button" className="ghost" onClick={() => move(index, index - 1)}>
                    ↑
                  </button>
                  <button type="button" className="ghost" onClick={() => move(index, index + 1)}>
                    ↓
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => setItems(items.filter((_, at) => at !== index))}
                  >
                    Убрать
                  </button>
                </div>
                <input
                  value={item.hint}
                  placeholder="Подсказка при заполнении в этом наборе"
                  onChange={(e) => {
                    const next = [...items];
                    next[index] = { ...item, hint: e.target.value };
                    setItems(next);
                  }}
                />
              </li>
            );
          })}
        </ol>

        <div className="row">
          <label style={{ flex: 1, minWidth: 220 }}>
            Добавить величину
            <select
              value={adding}
              onChange={(e) => {
                if (e.target.value) {
                  setItems([...items, { parameter: e.target.value, hint: "" }]);
                  setAdding("");
                }
              }}
            >
              <option value="">выберите из справочника</option>
              {free.map((row) => (
                <option key={row.code} value={row.code}>
                  {row.title_ru}
                  {row.unit ? `, ${row.unit}` : ""}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="ghost" onClick={() => setCreating(true)}>
            Нужной величины нет — завести
          </button>
        </div>
      </div>

      {creating && (
        <ParameterDialog
          onSaved={async (createdCode) => {
            await reloadRegistry();
            setItems((current) =>
              current.some((item) => item.parameter === createdCode)
                ? current
                : [...current, { parameter: createdCode, hint: "" }]
            );
          }}
          onClose={() => setCreating(false)}
        />
      )}
    </Modal>
  );
}
