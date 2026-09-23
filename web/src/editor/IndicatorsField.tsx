/**
 * Показатели записи: величины, которые подсказывает её ветвь дерева (Р-38).
 *
 * Показателей может быть несколько — «по проекту» и «после реконструкции»;
 * по действующим считаются отбор и сортировка, в карточке видны все.
 * Набор подсказывает состав, но не запрещает оставить величину пустой.
 */
import type { Indicator, IndicatorValue, SuggestedParameter } from "../api";

interface Props {
  indicators: Indicator[];
  suggested: SuggestedParameter[];
  onChange: (next: Indicator[]) => void;
}

function emptyIndicator(title: string): Indicator {
  return { title, is_current: true, measured_year: null, values: [] };
}

/** Значение параметра внутри показателей; пустое не хранится. */
function valueOf(indicator: Indicator, code: string): IndicatorValue | undefined {
  return indicator.values.find((value) => value.parameter === code);
}

function setValue(
  indicator: Indicator,
  code: string,
  patch: Partial<IndicatorValue>,
): Indicator {
  const values = [...indicator.values];
  const at = values.findIndex((value) => value.parameter === code);
  const next = { ...(at >= 0 ? values[at] : { parameter: code }), ...patch };
  if (at >= 0) values[at] = next;
  else values.push(next);
  return { ...indicator, values };
}

export function IndicatorsField({ indicators, suggested, onChange }: Props) {
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

  return (
    <div className="block">
      <h3>Показатели</h3>
      <p className="hint">
        Величины подсказаны ветвью дерева типов. Пустое не заполняется, единица измерения
        — часть определения параметра.
      </p>

      {indicators.map((indicator, index) => (
        <fieldset className="indicator" key={indicator.id ?? index}>
          <div className="row">
            <label>
              Название измерения
              <input
                value={indicator.title}
                placeholder="По проекту"
                onChange={(e) => update(index, { ...indicator, title: e.target.value })}
              />
            </label>
            <label>
              Год сведений
              <input
                value={indicator.measured_year ?? ""}
                inputMode="numeric"
                onChange={(e) =>
                  update(index, {
                    ...indicator,
                    measured_year: e.target.value ? Number(e.target.value) : null,
                  })}
              />
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={indicator.is_current}
                onChange={(e) => update(index, { ...indicator, is_current: e.target.checked })}
              />
              Действующие
            </label>
          </div>

          {fields.map((field) => {
            const value = valueOf(indicator, field.parameter);
            const label = field.unit ? `${field.title}, ${field.unit}` : field.title;
            if (field.value_type === "boolean") {
              return (
                <label className="checkbox" key={field.parameter}>
                  <input
                    type="checkbox"
                    checked={value?.bool_value === true}
                    onChange={(e) =>
                      update(
                        index,
                        setValue(indicator, field.parameter, { bool_value: e.target.checked }),
                      )}
                  />
                  {label}
                </label>
              );
            }
            if (field.value_type === "option") {
              return (
                <label key={field.parameter}>
                  {label}
                  <select
                    value={value?.option ?? ""}
                    onChange={(e) =>
                      update(
                        index,
                        setValue(indicator, field.parameter, { option: e.target.value || null }),
                      )}
                  >
                    <option value="">не указано</option>
                    {field.options.map((option) => (
                      <option key={option.code} value={option.code}>{option.title}</option>
                    ))}
                  </select>
                  {field.definition && <span className="hint">{field.definition}</span>}
                </label>
              );
            }
            const numeric = field.value_type === "number" || field.value_type === "integer";
            const dated = field.value_type === "date";
            return (
              <label key={field.parameter}>
                {label}
                <input
                  value={dated
                    ? value?.date_start_year ?? ""
                    : numeric
                    ? value?.num_value ?? ""
                    : value?.text_value ?? ""}
                  inputMode={numeric || dated ? "numeric" : undefined}
                  placeholder={field.hint ?? ""}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const patch: Partial<IndicatorValue> = dated
                      ? { date_start_year: raw ? Number(raw) : null }
                      : numeric
                      ? { num_value: raw === "" ? null : raw }
                      : { text_value: raw };
                    update(index, setValue(indicator, field.parameter, patch));
                  }}
                />
                {field.definition && <span className="hint">{field.definition}</span>}
              </label>
            );
          })}

          {indicators.length > 1 && (
            <button
              type="button"
              className="ghost"
              onClick={() => onChange(indicators.filter((_, at) => at !== index))}
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
    </div>
  );
}
