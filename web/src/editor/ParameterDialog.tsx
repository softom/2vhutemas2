/**
 * Окно параметра: создание и правка (правило 15, решение Р-38).
 *
 * Параметр — определение величины, а не поле формы: единица измерения и
 * пояснение «что именно считается» — его часть. Одно окно на оба действия,
 * различаются они только заполненностью полей.
 */
import { useState } from "react";
import { api, type ParameterRow } from "../api";
import { Modal } from "../ui/Modal";

export const VALUE_TYPES: { code: string; title: string }[] = [
  { code: "number", title: "число" },
  { code: "integer", title: "целое число" },
  { code: "text", title: "текст" },
  { code: "option", title: "список" },
  { code: "boolean", title: "да или нет" },
  { code: "date", title: "дата" },
  { code: "place", title: "место" },
];

/**
 * В окне список — два отдельных вида: один выбор и несколько. В модели это
 * один тип значения с признаком «несколько ответов»: хранится одинаково,
 * различается только тем, сколько ответов допустимо (Р-38).
 */
const KINDS: { code: string; title: string; value_type: string; many: boolean }[] = [
  { code: "number", title: "число", value_type: "number", many: false },
  { code: "integer", title: "целое число", value_type: "integer", many: false },
  { code: "text", title: "текст", value_type: "text", many: false },
  { code: "option_one", title: "список: один выбор", value_type: "option", many: false },
  { code: "option_many", title: "список: несколько", value_type: "option", many: true },
  { code: "boolean", title: "да или нет", value_type: "boolean", many: false },
  { code: "date", title: "дата", value_type: "date", many: false },
  { code: "place", title: "место", value_type: "place", many: false },
];

function kindOf(valueType: string, repeatable: boolean): string {
  if (valueType === "option") return repeatable ? "option_many" : "option_one";
  return valueType;
}

/** Код из названия: латиницей, потому что по нему обращаются в API. */
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

interface Props {
  /** Пусто — новый параметр. */
  parameter?: ParameterRow | null;
  onSaved: (code: string) => void;
  onClose: () => void;
}

export function ParameterDialog({ parameter, onSaved, onClose }: Props) {
  const editing = !!parameter;
  const [draft, setDraft] = useState({
    code: parameter?.code ?? "",
    title_ru: parameter?.title_ru ?? "",
    unit: parameter?.unit ?? "",
    kind: kindOf(parameter?.value_type ?? "number", parameter?.is_repeatable ?? false),
    definition: parameter?.definition ?? "",
    is_repeatable: parameter?.is_repeatable ?? false,
  });
  const [options, setOptions] = useState<{ code: string; title: string }[]>(
    parameter?.options ?? [],
  );
  const [adding, setAdding] = useState("");
  const [codeTouched, setCodeTouched] = useState(editing);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const used = Number(parameter?.used ?? 0);

  const set = (patch: Partial<typeof draft>) => setDraft({ ...draft, ...patch });

  /** Значение списка заводится по Enter или кнопкой; повтор не добавляется. */
  const addOption = () => {
    const title = adding.trim();
    const code = codeFrom(title);
    if (!title || options.some((item) => item.code === code)) return;
    setOptions([...options, { code, title }]);
    setAdding("");
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const kind = KINDS.find((item) => item.code === draft.kind)!;
      if (kind.value_type === "option" && options.length === 0) {
        throw new Error("У списка должны быть значения");
      }
      const body = {
        code: draft.code.trim(),
        title_ru: draft.title_ru.trim(),
        unit: draft.unit.trim() || null,
        value_type: kind.value_type,
        definition: draft.definition.trim() || null,
        // «Несколько» у списка — это и есть повторяемость ответа.
        is_repeatable: kind.value_type === "option" ? kind.many : draft.is_repeatable,
        options: kind.value_type === "option"
          ? options.map((option) => ({ code: option.code, title_ru: option.title }))
          : undefined,
      };
      if (editing) await api.updateParameter(parameter!.id, body);
      else await api.createParameter(body);
      onSaved(body.code);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={editing ? "Правка параметра" : "Новый параметр"}
      dirty={draft.title_ru.trim() !== (parameter?.title_ru ?? "")}
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
            Название
            <input
              autoFocus
              value={draft.title_ru}
              placeholder="Вместимость зала"
              onChange={(e) => {
                const title = e.target.value;
                set(codeTouched ? { title_ru: title } : { title_ru: title, code: codeFrom(title) });
              }}
            />
          </label>
          <label>
            Код
            <input
              value={draft.code}
              disabled={editing}
              onChange={(e) => {
                setCodeTouched(true);
                set({ code: e.target.value });
              }}
            />
            <span className="hint">По нему величина видна в API; после заполнения не меняется</span>
          </label>
        </div>

        <div className="row">
          <label>
            Вид значения
            <select
              value={draft.kind}
              disabled={used > 0}
              onChange={(e) => set({ kind: e.target.value })}
            >
              {KINDS.map((kind) => (
                <option key={kind.code} value={kind.code}>{kind.title}</option>
              ))}
            </select>
            {used > 0 && (
              <span className="hint">Величина заполнена {used} раз — вид не меняется</span>
            )}
          </label>
          <label>
            Единица измерения
            <input
              value={draft.unit}
              placeholder="мест, м, м²"
              onChange={(e) => set({ unit: e.target.value })}
            />
            <span className="hint">Часть определения, а не подпись рядом со значением</span>
          </label>
          {!draft.kind.startsWith("option") && (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={draft.is_repeatable}
                onChange={(e) => set({ is_repeatable: e.target.checked })}
              />
              Несколько ответов
            </label>
          )}
        </div>

        {draft.kind.startsWith("option") && (
          <div className="value-field">
            <div className="value-label">Значения списка</div>
            {options.length === 0 && <p className="notice">Пока пусто.</p>}
            <div className="chips">
              {options.map((option) => (
                <span className="chip" key={option.code}>
                  {option.title}
                  <button
                    type="button"
                    className="chip-remove"
                    onClick={() =>
                      setOptions(options.filter((item) => item.code !== option.code))}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
            <div className="value-row">
              <input
                value={adding}
                placeholder="железобетон"
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  addOption();
                }}
                onChange={(e) => setAdding(e.target.value)}
              />
              <button type="button" className="ghost" onClick={addOption}>
                Добавить значение
              </button>
            </div>
            <span className="hint">
              {draft.kind === "option_many"
                ? "Из этого списка можно выбрать несколько ответов"
                : "Из этого списка выбирается один ответ"}
            </span>
          </div>
        )}

        <label>
          Что именно считается этой величиной
          <input
            value={draft.definition}
            placeholder="Только зрительный зал, без балконов и приставных мест"
            onChange={(e) => set({ definition: e.target.value })}
          />
          <span className="hint">Для учебного сравнения это важнее самого числа</span>
        </label>
      </div>
    </Modal>
  );
}
