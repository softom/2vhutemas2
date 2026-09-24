/**
 * Показатели записи и их значения (решение Р-38).
 *
 * Показатели — одно измерение целиком: «по проекту», «после реконструкции».
 * Их может быть несколько, и по действующим считаются отбор и сортировка,
 * а в карточке видно все.
 *
 * Показатели входят в материал записи: их правка создаёт версию и проходит
 * обычную публикацию. Отдельного авторства у измерений нет.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { transaction, type Tx } from "../lib/db.ts";
import { ApiError } from "../lib/errors.ts";
import { require as requirePermission } from "../lib/auth.ts";
import type { AppEnv } from "../lib/http.ts";

export const indicators = new Hono<AppEnv>();

interface ValueInput {
  parameter: string;
  num_value?: number | string | null;
  text_value?: string | null;
  bool_value?: boolean | null;
  option?: string | null;
  /** Место из справочника: для параметров с типом «место» (Р-39). */
  place_id?: string | null;
  date_start_year?: number | null;
  date_start_month?: number | null;
  date_start_day?: number | null;
  date_end_year?: number | null;
  date_end_month?: number | null;
  date_end_day?: number | null;
  is_approximate?: boolean;
  is_ongoing?: boolean;
  note?: string | null;
}

interface IndicatorInput {
  title?: string;
  is_current?: boolean;
  measured_year?: number | null;
  measured_by?: string | null;
  source_reference_item_id?: number | null;
  note?: string | null;
  values: ValueInput[];
}

/** Пустое значение не записывается: незаполненный параметр остаётся пустым. */
function filled(value: ValueInput): boolean {
  return value.num_value !== null && value.num_value !== undefined && value.num_value !== "" ||
    !!value.text_value?.trim() ||
    value.bool_value !== null && value.bool_value !== undefined ||
    !!value.option || !!value.place_id ||
    value.date_start_year !== null && value.date_start_year !== undefined;
}

async function readAll(tx: Tx, entityId: number) {
  return await tx<Record<string, unknown>>`
    select i.id, i.title, i.is_current, i.measured_year, i.measured_by, i.note, i.sort_order,
           coalesce((select jsonb_agg(jsonb_build_object(
                        'parameter', p.code, 'title', p.title_ru, 'unit', p.unit,
                        'value_type', p.value_type,
                        'num_value', iv.num_value, 'text_value', iv.text_value,
                        'bool_value', iv.bool_value,
                        'option', (select o.code from app.parameter_options o
                                    where o.id = iv.option_id),
                        'place_id', iv.place_id,
                        'place', (select to_jsonb(pl) from app.places pl
                                   where pl.id = iv.place_id),
                        'date_start_year', iv.date_start_year,
                        'date_end_year', iv.date_end_year,
                        'is_approximate', iv.is_approximate, 'is_ongoing', iv.is_ongoing,
                        'note', iv.note)
                        order by p.sort_order, p.title_ru, iv.sort_order)
                     from app.indicator_values iv
                     join app.parameters p on p.id = iv.parameter_id
                    where iv.indicator_id = i.id), '[]'::jsonb) as values
      from app.indicators i
     where i.entity_id = ${entityId}
     order by i.sort_order, i.id
  `;
}

/**
 * Список задаётся целиком, как датировки: что прислали, то и осталось.
 * Так правка не зависит от того, что клиент видел раньше.
 */
indicators.put("/:id", async (c: Context<AppEnv>) => {
  const principal = requirePermission(c.get("principal"), "edit");
  const entityId = Number(c.req.param("id"));
  if (!Number.isInteger(entityId)) throw new ApiError("validation_failed", "Неверная запись");

  const input = await c.req.json<{ indicators: IndicatorInput[]; base_revision_id?: string }>();
  const items = input.indicators ?? [];
  const baseRevisionId = input.base_revision_id ?? c.req.header("if-match") ?? null;

  const result = await transaction(principal.contributorId, async (tx) => {
    const found = await tx<{ id: number }>`select id from app.entities where id = ${entityId}`;
    if (found.length === 0) throw new ApiError("not_found", "Запись не найдена");

    const materials = await tx<{ material_id: string; latest_revision_id: string | null }>`
      select m.id as material_id,
             (select r.id from app.revisions r where r.material_id = m.id
               order by r.created_at desc limit 1) as latest_revision_id
        from app.materials m where m.entity_id = ${entityId}
        for update
    `;
    const material = materials[0];
    if (material && baseRevisionId && material.latest_revision_id &&
      material.latest_revision_id !== baseRevisionId
    ) {
      throw new ApiError(
        "version_conflict",
        "Запись изменена другим редактором. Перечитайте карточку и повторите правку.",
        { latest_revision_id: material.latest_revision_id },
      );
    }

    await tx`delete from app.indicators where entity_id = ${entityId}`;

    for (const [index, item] of items.entries()) {
      const title = item.title?.trim() || "Сведения";
      const inserted = await tx<{ id: string }>`
        insert into app.indicators (entity_id, title, is_current, measured_year, measured_by,
                                    source_reference_item_id, note, sort_order)
        values (${entityId}, ${title}, ${item.is_current ?? true},
                ${item.measured_year ?? null}, ${item.measured_by ?? null},
                ${item.source_reference_item_id ?? null}, ${item.note ?? null}, ${index})
        returning id
      `;
      const indicatorId = inserted[0].id;

      for (const [position, value] of (item.values ?? []).entries()) {
        if (!filled(value)) continue;
        const parameters = await tx<{ id: string; value_type: string }>`
          select id, value_type from app.parameters where code = ${value.parameter}
        `;
        if (parameters.length === 0) {
          throw new ApiError("validation_failed", "Неизвестный параметр", {
            parameter: value.parameter,
          });
        }
        const parameter = parameters[0];
        const numeric = value.num_value === null || value.num_value === undefined ||
            value.num_value === ""
          ? null
          : Number(value.num_value);
        if (numeric !== null && Number.isNaN(numeric)) {
          throw new ApiError("validation_failed", `Параметру «${value.parameter}» нужно число`);
        }

        await tx`
          insert into app.indicator_values (
              indicator_id, parameter_id, num_value, text_value, bool_value, option_id,
              place_id, date_start_year, date_start_month, date_start_day,
              date_end_year, date_end_month, date_end_day,
              is_approximate, is_ongoing, note, sort_order)
          values (${indicatorId}, ${parameter.id}, ${numeric},
                  ${value.text_value ?? null}, ${value.bool_value ?? null},
                  (select o.id from app.parameter_options o
                    where o.parameter_id = ${parameter.id} and o.code = ${value.option ?? null}),
                  ${value.place_id ?? null},
                  ${value.date_start_year ?? null}, ${value.date_start_month ?? null},
                  ${value.date_start_day ?? null}, ${value.date_end_year ?? null},
                  ${value.date_end_month ?? null}, ${value.date_end_day ?? null},
                  ${value.is_approximate ?? false}, ${value.is_ongoing ?? false},
                  ${value.note ?? null}, ${position})
        `;
      }
    }

    // Показатели — часть материала записи: правка создаёт версию (Р-38).
    let revisionId: string | null = null;
    if (material) {
      const snapshotRows = await tx<{ data: unknown }>`
        select to_jsonb(e) || jsonb_build_object(
                 'type', ty.code,
                 'indicators', coalesce((select jsonb_agg(to_jsonb(i) order by i.sort_order)
                                         from app.indicators i where i.entity_id = e.id),
                                        '[]'::jsonb)) as data
          from app.entities e
          join app.entity_types ty on ty.id = e.type_id
         where e.id = ${entityId}
      `;
      const revisions = await tx<{ id: string }>`
        insert into app.revisions (material_id, base_revision_id, edited_by, operation, summary,
                                   snapshot)
        values (${material.material_id}, ${material.latest_revision_id},
                ${principal.contributorId}, 'edit', 'Правка показателей',
                ${JSON.stringify(snapshotRows[0]?.data ?? {})}::jsonb)
        returning id
      `;
      revisionId = revisions[0].id;
    }

    return { items: await readAll(tx, entityId), revision_id: revisionId };
  });

  return c.json(result);
});
