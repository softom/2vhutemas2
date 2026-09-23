/**
 * Датировки сущности (решение Р-08).
 *
 * Одна запись — одна дата своего вида: рождение, проектирование, открытие,
 * реконструкция, утрата. Пара годов в карточке заменена этим списком, потому
 * что у здания замысел, стройка и открытие приходятся на разные годы.
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

/** Список задаётся целиком: что прислали, то и остаётся у сущности. */
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

    await tx`delete from app.entity_dates where entity_id = ${entityId}`;

    for (const [index, item] of items.entries()) {
      const kinds = await tx<{ id: string }>`
        select id from app.date_kinds where code = ${item.kind}
      `;
      if (kinds.length === 0) {
        throw new ApiError("validation_failed", "Неизвестный вид даты", { kind: item.kind });
      }
      await tx`
        insert into app.entity_dates (entity_id, kind_id, start_year, start_month, start_day,
                                      end_year, end_month, end_day, is_approximate, is_ongoing,
                                      note, sort_order)
        values (${entityId}, ${kinds[0].id}, ${item.start_year}, ${item.start_month ?? null},
                ${item.start_day ?? null}, ${item.end_year ?? null}, ${item.end_month ?? null},
                ${item.end_day ?? null}, ${item.is_approximate ?? false},
                ${item.is_ongoing ?? false}, ${item.note ?? null}, ${index})
      `;
    }

    return tx<Record<string, unknown>>`
      select d.id, k.code as kind, k.title_ru as kind_title, d.start_year, d.start_month,
             d.start_day, d.end_year, d.end_month, d.end_day, d.is_approximate, d.is_ongoing,
             d.note
      from app.entity_dates d
      join app.date_kinds k on k.id = d.kind_id
      where d.entity_id = ${entityId}
      order by d.sort_order
    `;
  });

  return c.json({ items: result });
});
