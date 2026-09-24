/**
 * Датировки записи (решения Р-38, Р-39).
 *
 * Дата больше не отдельная сущность: вид даты — проектирование, открытие,
 * рождение — это параметр со значением-датой, а хранится она в показателях
 * записи наравне с прочими величинами.
 *
 * Маршрут сохранён: он описан в API и им пользуются сценарии наполнения.
 * Здесь он переводит привычный список датировок в значения параметров.
 *
 * Неизвестное остаётся пустым: приблизительность отмечается признаком,
 * а не выдуманной точной датой.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { transaction } from "../lib/db.ts";
import { ApiError } from "../lib/errors.ts";
import { require as requirePermission } from "../lib/auth.ts";
import type { AppEnv } from "../lib/http.ts";

export const dates = new Hono<AppEnv>();

interface DateInput {
  kind: string;
  start_year: number;
  start_month?: number | null;
  start_day?: number | null;
  end_year?: number | null;
  end_month?: number | null;
  end_day?: number | null;
  is_approximate?: boolean;
  is_ongoing?: boolean;
  note?: string | null;
}

function validate(items: DateInput[]): void {
  items.forEach((item, index) => {
    const at = `датировка ${index + 1}`;
    if (!item.kind) throw new ApiError("validation_failed", `${at}: не указан вид даты`);
    if (!Number.isInteger(item.start_year)) {
      throw new ApiError("validation_failed", `${at}: не указан начальный год`);
    }
    if (item.end_year !== null && item.end_year !== undefined && item.end_year < item.start_year) {
      throw new ApiError("validation_failed", `${at}: конец раньше начала`);
    }
    if (item.is_ongoing && item.end_year) {
      throw new ApiError(
        "validation_failed",
        `${at}: открытый интервал не может иметь конечный год`,
      );
    }
  });
}

/** Список задаётся целиком: что прислали, то и остаётся у записи. */
dates.put("/:id", async (c: Context<AppEnv>) => {
  const principal = requirePermission(c.get("principal"), "edit");
  const entityId = Number(c.req.param("id"));
  if (!Number.isInteger(entityId)) throw new ApiError("validation_failed", "Неверный объект");

  const input = await c.req.json<{ dates: DateInput[] }>();
  const items = input.dates ?? [];
  validate(items);

  const result = await transaction(principal.contributorId, async (tx) => {
    const found = await tx<{ id: number }>`select id from app.entities where id = ${entityId}`;
    if (found.length === 0) throw new ApiError("not_found", "Объект не найден");

    const existing = await tx<{ id: string }>`
      select id from app.indicators where entity_id = ${entityId} order by sort_order, id limit 1
    `;
    const indicatorId = existing.length > 0 ? existing[0].id : (await tx<{ id: string }>`
      insert into app.indicators (entity_id, title) values (${entityId}, 'Сведения') returning id
    `)[0].id;

    // Меняем только датировки: прочие величины записи остаются как были.
    await tx`
      delete from app.indicator_values iv
       using app.parameters p, app.indicators i
       where iv.parameter_id = p.id and iv.indicator_id = i.id
         and p.value_type = 'date' and i.entity_id = ${entityId}
    `;

    for (const [index, item] of items.entries()) {
      const parameters = await tx<{ id: string }>`
        select id from app.parameters where code = ${item.kind} and value_type = 'date'
      `;
      if (parameters.length === 0) {
        throw new ApiError("validation_failed", "Неизвестный вид даты", { kind: item.kind });
      }
      await tx`
        insert into app.indicator_values (
            indicator_id, parameter_id, date_start_year, date_start_month, date_start_day,
            date_end_year, date_end_month, date_end_day, is_approximate, is_ongoing,
            note, sort_order)
        values (${indicatorId}, ${parameters[0].id}, ${item.start_year},
                ${item.start_month ?? null}, ${item.start_day ?? null},
                ${item.end_year ?? null}, ${item.end_month ?? null}, ${item.end_day ?? null},
                ${item.is_approximate ?? false}, ${item.is_ongoing ?? false},
                ${item.note ?? null}, ${index})
      `;
    }

    return tx<Record<string, unknown>>`
      select p.code as kind, p.title_ru as kind_title, iv.date_start_year as start_year,
             iv.date_start_month as start_month, iv.date_start_day as start_day,
             iv.date_end_year as end_year, iv.date_end_month as end_month,
             iv.date_end_day as end_day, iv.is_approximate, iv.is_ongoing, iv.note
        from app.indicator_values iv
        join app.parameters p on p.id = iv.parameter_id
        join app.indicators i on i.id = iv.indicator_id
       where i.entity_id = ${entityId} and p.value_type = 'date'
       order by iv.sort_order
    `;
  });

  return c.json({ items: result });
});
