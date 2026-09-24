/**
 * Показатели записи: величины, которые подсказывает её ветвь дерева (Р-38).
 *
 * Показателей может быть несколько — «по проекту» и «после реконструкции»;
 * по действующим считаются отбор и сортировка, в карточке видны все.
 *
 * Дата и место — такие же величины, как вместимость зала (Р-39): вид даты
 * и роль места стали параметрами. У таких вопросов бывает несколько ответов
 * — две реконструкции, два адреса, — поэтому они заполняются списком.
 */
import { useState } from "react";
import { type Indicator, type IndicatorValue, placeLabel, type SuggestedParameter } from "../api";
import { PlacePicker } from "./PlacePicker";
import { PlaceDialog } from "./PlaceDialog";

interface Props {
  indicators: Indicator[];
  suggested: SuggestedParameter[];
  onChange: (next: Indicator[]) => void;
}

function emptyIndicator(title: string): Indicator {
  return { title, is_current: true, measured_year: null, values: [] };
}

function repeatable(field: SuggestedParameter): boolean {
  return field.is_repeatable ?? (field.value_type === "date" || field.value_type === "place");
}

export function IndicatorsField({ indicators, suggested, onChange }: Props) {
  // Окно места открывается поверх формы: универсальный элемент правится
  // в собственном окне (правило 15).
  const [picking, setPicking] = useState<{ group: number; position: number } | null>(null);
  const [creating, setCreating] = useState<{ group: number; position: number } | null>(null);

  // Показываем подсказанное ветвью и то, что уже заполнено вне набора:
  // набор подсказывает состав, но не ограничивает его.
  const extra = new Map<string, SuggestedParameter>();
  for (const indicator of indicators) {
    for (const value of indicator.values) {
      if (!suggested.some((item) => item.parameter === value.parameter)) {
        extra.set(value.parameter, {
          parameter: value.parameter,
          title: value.title ?? value.parameter,
          unit: value.unit ?? null,
          value_type: value.value_type ?? "text",
          definition: null,
          set: "",
          set_title: "вне набора",
          hint: null,
          options: [],
        });
      }
    }
  }
  const fields = [...suggested, ...extra.values()];

  const update = (index: number, next: Indicator) => {
    const items = [...indicators];
    items[index] = next;
    onChange(items);
  };

  /** Значения одного параметра внутри показателей вместе с их местами в списке. */
  const entriesOf = (indicator: Indicator, code: string) =>
    indicator.values
      .map((value, position) => ({ value, position }))
      .filter((entry) => entry.value.parameter === code);

  const patchValue = (
    group: number,
    position: number,
    patch: Partial<IndicatorValue>,
  ) => {
    const indicator = indicators[group];
    const values = [...indicator.values];
    values[position] = { ...values[position], ...patch };
    update(group, { ...indicator, values });
  };

  const addValue = (group: number, code: string) => {
    const indicator = indicators[group];
    update(group, { ...indicator, values: [...indicator.values, { parameter: code }] });
  };

  const removeValue = (group: number, position: number) => {
    const indicator = indicators[group];
    update(group, {
      ...indicator,
      values: indicator.values.filter((_, at) => at !== position),
    });
  };

  /** Место выбрано или заведено: значение получает ссылку на справочник. */
  const setPlace = (target: { group: number; position: number }, placeId: string) => {
    patchValue(target.group, target.position, { place_id: placeId, place: undefined });
    setPicking(null);
    setCreating(null);
  };

  if (fields.length === 0 && indicators.length === 0) {
    return (
      <div className="block">
        <h3>Показатели</h3>
        <p className="hint">
          Для этого типа записи набор параметров ещё не задан. Параметры заводятся в справочнике.
        </p>
      </div>
    );
  }

  const valueInput = (
    group: number,
    field: SuggestedParameter,
    entry: { value: IndicatorValue; position: number },
  ) => {
    const { value, position } = entry;
    const set = (patch: Partial<IndicatorValue>) => patchValue(group, position, patch);

    if (field.value_type === "place") {
      return (
        <div className="value-row" key={position}>
          <span className="value-place">
            {value.place ? placeLabel(value.place) : value.place_id ? "место выбрано" : "не указано"}
          </span>
          <button type="button" className="ghost" onClick={() => setPicking({ group, position })}>
            Выбрать
          </button>
          <button type="button" className="ghost" onClick={() => setCreating({ group, position })}>
            Создать
          </button>
          <button type="button" className="ghost" onClick={() => removeValue(group, position)}>
            Убрать
          </button>
        </div>
      );
    }

    if (field.value_type === "date") {
      return (
        <div className="value-row" key={position}>
          <input
            className="year"
            inputMode="numeric"
            placeholder="год"
            value={value.date_start_year ?? ""}
            onChange={(e) =>
              set({ date_start_year: e.target.value ? Number(e.target.value) : null })}
          />
          <input
            className="year"
            inputMode="numeric"
            placeholder="по год"
            value={value.date_end_year ?? ""}
            onChange={(e) => set({ date_end_year: e.target.value ? Number(e.target.value) : null })}
          />
          <label className="checkbox">
            <input
              type="checkbox"
              checked={value.is_approximate === true}
              onChange={(e) => set({ is_approximate: e.target.checked })}
            />
            около
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={value.is_ongoing === true}
              onChange={(e) => set({ is_ongoing: e.target.checked, date_end_year: null })}
            />
            продолжается
          </label>
          <button type="button" className="ghost" onClick={() => removeValue(group, position)}>
            Убрать
          </button>
        </div>
      );
    }

    if (field.value_type === "boolean") {
      return (
        <label className="checkbox" key={position}>
          <input
            type="checkbox"
            checked={value.bool_value === true}
            onChange={(e) => set({ bool_value: e.target.checked })}
          />
          да
        </label>
      );
    }

    if (field.value_type === "option") {
      return (
        <select
          key={position}
          value={value.option ?? ""}
          onChange={(e) => set({ option: e.target.value || null })}
        >
          <option value="">не указано</option>
          {field.options.map((option) => (
            <option key={option.code} value={option.code}>{option.title}</option>
          ))}
        </select>
      );
    }

    const numeric = field.value_type === "number" || field.value_type === "integer";
    return (
      <input
        key={position}
        value={numeric ? value.num_value ?? "" : value.text_value ?? ""}
        inputMode={numeric ? "numeric" : undefined}
        placeholder={field.hint ?? ""}
        onChange={(e) =>
          set(numeric ? { num_value: e.target.value || null } : { text_value: e.target.value })}
      />
    );
  };

  return (
    <div className="block">
      <h3>Показатели</h3>
      <p className="hint">
        Величины подсказаны ветвью дерева типов. Даты и места — такие же величины;
        пустое не заполняется.
      </p>

      {indicators.map((indicator, group) => (
        <fieldset className="indicator" key={indicator.id ?? group}>
          <div className="row">
            <label>
              Название измерения
              <input
                value={indicator.title}
                placeholder="По проекту"
                onChange={(e) => update(group, { ...indicator, title: e.target.value })}
              />
            </label>
            <label>
              Год сведений
              <input
                value={indicator.measured_year ?? ""}
                inputMode="numeric"
                onChange={(e) =>
                  update(group, {
                    ...indicator,
                    measured_year: e.target.value ? Number(e.target.value) : null,
                  })}
              />
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={indicator.is_current}
                onChange={(e) => update(group, { ...indicator, is_current: e.target.checked })}
              />
              Действующие
            </label>
          </div>

          {fields.map((field) => {
            const entries = entriesOf(indicator, field.parameter);
            const many = repeatable(field);
            if (entries.length === 0 && !many) {
              // Единственный ответ заводится сразу, чтобы поле было видно.
              return (
                <label key={field.parameter}>
                  {field.unit ? `${field.title}, ${field.unit}` : field.title}
                  <input
                    value=""
                    placeholder={field.hint ?? ""}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const numeric = field.value_type === "number" ||
                        field.value_type === "integer";
                      const indicatorNow = indicators[group];
                      update(group, {
                        ...indicatorNow,
                        values: [...indicatorNow.values, {
                          parameter: field.parameter,
                          ...(numeric ? { num_value: raw } : { text_value: raw }),
                        }],
                      });
                    }}
                  />
                  {field.definition && <span className="hint">{field.definition}</span>}
                </label>
              );
            }
            return (
              <div className="value-field" key={field.parameter}>
                <div className="value-label">
                  {field.unit ? `${field.title}, ${field.unit}` : field.title}
                </div>
                {entries.map((entry) => valueInput(group, field, entry))}
                {many && (
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => addValue(group, field.parameter)}
                  >
                    {entries.length === 0 ? "Указать" : "Добавить ещё"}
                  </button>
                )}
                {field.definition && <span className="hint">{field.definition}</span>}
              </div>
            );
          })}

          {indicators.length > 1 && (
            <button
              type="button"
              className="ghost"
              onClick={() => onChange(indicators.filter((_, at) => at !== group))}
            >
              Убрать измерение
            </button>
          )}
        </fieldset>
      ))}

      <button
        type="button"
        className="ghost"
        onClick={() =>
          onChange([
            ...indicators,
            emptyIndicator(indicators.length === 0 ? "Сведения" : "После реконструкции"),
          ])}
      >
        {indicators.length === 0 ? "Заполнить показатели" : "Добавить измерение"}
      </button>

      {picking && (
        <PlacePicker
          onPick={(placeId) => setPlace(picking, placeId)}
          onCreateNew={() => {
            setCreating(picking);
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      )}
      {creating && (
        <PlaceDialog
          onSaved={(placeId) => setPlace(creating, placeId)}
          onClose={() => setCreating(null)}
        />
      )}
    </div>
  );
}
