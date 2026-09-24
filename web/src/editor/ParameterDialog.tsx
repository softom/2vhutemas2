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
  { code: "boolean", title: "да или нет" },
  { code: "option", title: "выбор из списка" },
  { code: "date", title: "дата" },
  { code: "place", title: "место" },
];

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
    value_type: parameter?.value_type ?? "number",
    definition: parameter?.definition ?? "",
    is_repeatable: parameter?.is_repeatable ?? false,
    options: (parameter?.options ?? []).map((option) => option.title).join(", "),
  });
  const [codeTouched, setCodeTouched] = useState(editing);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const used = Number(parameter?.used ?? 0);

  const set = (patch: Partial<typeof draft>) => setDraft({ ...draft, ...patch });

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const body = {
        code: draft.code.trim(),
        title_ru: draft.title_ru.trim(),
        unit: draft.unit.trim() || null,
        value_type: draft.value_type,
        definition: draft.definition.trim() || null,
        is_repeatable: draft.is_repeatable,
        options: draft.value_type === "option"
          ? draft.options.split(",").map((title) => title.trim()).filter(Boolean)
            .map((title) => ({ code: codeFrom(title), title_ru: title }))
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
            Тип значения
            <select
              value={draft.value_type}
              disabled={used > 0}
              onChange={(e) => set({ value_type: e.target.value })}
            >
              {VALUE_TYPES.map((type) => (
                <option key={type.code} value={type.code}>{type.title}</option>
              ))}
            </select>
            {used > 0 && <span className="hint">Величина заполнена {used} раз — тип не меняется</span>}
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
          <label className="checkbox">
            <input
              type="checkbox"
              checked={draft.is_repeatable}
              onChange={(e) => set({ is_repeatable: e.target.checked })}
            />
            Несколько ответов
          </label>
        </div>

        {draft.value_type === "option" && (
          <label>
            Список значений
            <input
              value={draft.options}
              placeholder="кирпич, железобетон, металл"
              onChange={(e) => set({ options: e.target.value })}
            />
            <span className="hint">Через запятую</span>
          </label>
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
