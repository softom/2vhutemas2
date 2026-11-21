import { ApiError } from "./errors.ts";
import { modelPath } from "./modelWidgets.ts";
import { styleQuizKey } from "./styleQuizWidget.ts";

type Field =
  | { type: "text"; default: string }
  | { type: "integer"; default: number; min: number; max: number }
  | { type: "entity_uid"; default: null };
type Fields = Record<string, Field>;

export function instanceContract(key: string, designs: string[]) {
  const display_options: Fields = {};
  const call_params: Fields = {};
  if (modelPath(key)) {
    display_options.title = { type: "text", default: "" };
    display_options.caption = { type: "text", default: "" };
    display_options.height = { type: "integer", min: 320, max: 900, default: 560 };
  } else if (key !== styleQuizKey) {
    call_params.entity_id = { type: "entity_uid", default: null };
  }
  return { design: { type: "enum", values: designs, default: designs[0] }, display_options, call_params };
}

// An omitted group is preserved on a same-widget edit; an empty object resets it.
export function instanceOverrides(value: unknown, fields: Fields): string | null {
  if (value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError("validation_failed", "Ожидается объект настроек виджета");
  }
  for (const [name, setting] of Object.entries(value)) {
    const field = Object.hasOwn(fields, name) && fields[name];
    if (field) {
      if (field.type === "text" && typeof setting === "string") continue;
      if (field.type === "integer" && typeof setting === "number" && Number.isInteger(setting)
          && setting >= field.min && setting <= field.max) continue;
      if (field.type === "entity_uid" && (setting === null ||
          (typeof setting === "string" && /^[1-9]\d{0,18}$/.test(setting) &&
           BigInt(setting) <= 9223372036854775807n))) continue;
    }
    throw new ApiError("validation_failed", "Недопустимое свойство виджета: " + name);
  }
  return JSON.stringify(value);
}
