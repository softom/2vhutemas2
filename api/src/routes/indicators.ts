/**
 * Показатели записи и их значения (решение Р-38).
 *
 * Показатели — одно измерение целиком: «по проекту», «после реконструкции».
 * Их может быть несколько, и по действующим считаются отбор и сортировка,
 * а в карточке видно все.
 *
 * Показатели входят в версию записи: их правка создаёт редакцию и проходит
 * обычную публикацию (Р-78). Таблицы показателей — рабочая копия; что видит
 * читатель, решает опубликованный снимок.
 *
 * Ответ величины бывает записью: «Адрес объекта» — запись «Место» (Р-85).
 * Клиент знает такой ответ как «место» с полем place_id — это номер записи.
 * Собственный текст записи — тоже значение параметра, «Текст» (Р-86), но он
 * правится вместе с записью полем body_json и в списке величин не участвует.
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
  /** Ответ-запись: номер записи. Для места клиент шлёт его как place_id (Р-85). */
  place_id?: string | number | null;
  entity_value_id?: string | number | null;
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

export interface IndicatorInput {
  title?: string;
  is_current?: boolean;
  measured_year?: number | null;
  measured_by?: string | null;
  /** Источник сведений группы — запись-источник (Р-84). */
  source_entity_id?: number | null;
  note?: string | null;
  values: ValueInput[];
}

/** Номер записи-ответа: пусто — нет ответа. */
function entityAnswer(value: ValueInput): number | null {
  const raw = value.entity_value_id ?? value.place_id;
  if (raw === null || raw === undefined || raw === "") return null;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiError("validation_failed", `Ответ «${value.parameter}» должен быть записью`);
  }
  return id;
}

/** Пустое значение не записывается: незаполненный параметр остаётся пустым. */
function filled(value: ValueInput): boolean {
  return value.num_value !== null && value.num_value !== undefined && value.num_value !== "" ||
    !!value.text_value?.trim() ||
    value.bool_value !== null && value.bool_value !== undefined ||
    !!value.option || entityAnswer(value) !== null ||
    value.date_start_year !== null && value.date_start_year !== undefined;
}

/**
 * Рабочая копия показателей — для редактора. Текст сюда не входит: у него
 * свой редактор и своё поле в ответе карточки.
 */
export async function readAll(tx: Tx, entityId: number) {
  return await tx<Record<string, unknown>>`
    select i.id, i.title, i.is_current, i.measured_year, i.measured_by, i.note, i.sort_order,
           i.source_entity_id,
           coalesce((select jsonb_agg(jsonb_build_object(
                        'parameter', p.code, 'title', p.title_ru, 'unit', p.unit,
                        'value_type', app.api_value_type(p.id),
                        'num_value', iv.num_value, 'text_value', iv.text_value,
                        'bool_value', iv.bool_value,
                        'option', (select o.code from app.parameter_options o where o.id = iv.option_id),
                        'option_title', (select o.title_ru from app.parameter_options o
                                          where o.id = iv.option_id),
                        'place_id', iv.entity_value_id::text,
                        'entity_value_id', iv.entity_value_id,
                        'place', case when iv.entity_value_id is not null
                                      then app.place_json(iv.entity_value_id, true) end,
                        'date_start_year', iv.date_start_year, 'date_start_month', iv.date_start_month,
                        'date_start_day', iv.date_start_day, 'date_end_year', iv.date_end_year,
                        'date_end_month', iv.date_end_month, 'date_end_day', iv.date_end_day,
                        'is_approximate', iv.is_approximate, 'is_ongoing', iv.is_ongoing,
                        'note', iv.note)
                        order by p.sort_order, p.title_ru, iv.sort_order)
                     from app.indicator_values iv
                     join app.parameters p on p.id = iv.parameter_id
                    where iv.indicator_id = i.id and p.value_type <> 'blocks'), '[]'::jsonb) as values
      from app.indicators i
     where i.entity_id = ${entityId}
       and not exists (select 1 from app.indicator_values tv
                         join app.parameters tp on tp.id = tv.parameter_id
                        where tv.indicator_id = i.id and tp.value_type = 'blocks')
     order by i.sort_order, i.id
  `;
}

/**
 * Список показателей задаётся целиком. Группа с текстом записи этим списком
 * не управляется: иначе сохранение величин стирало бы текст лекции.
 */
export async function writeIndicators(tx: Tx, entityId: number, items: IndicatorInput[]) {
  await tx`
    delete from app.indicators i
     where i.entity_id = ${entityId}
       and not exists (select 1 from app.indicator_values tv
                         join app.parameters tp on tp.id = tv.parameter_id
                        where tv.indicator_id = i.id and tp.value_type = 'blocks')
  `;

  for (const [index, item] of items.entries()) {
    const title = item.title?.trim() || "Сведения";
    const inserted = await tx<{ id: string }>`
      insert into app.indicators (entity_id, title, is_current, measured_year, measured_by,
                                  source_entity_id, note, sort_order)
      values (${entityId}, ${title}, ${item.is_current ?? true},
              ${item.measured_year ?? null}, ${item.measured_by ?? null},
              ${item.source_entity_id ?? null}, ${item.note ?? null}, ${index})
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
      // Текст пишется полем body_json карточки, а не списком величин.
      if (parameter.value_type === "blocks") continue;
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
            entity_value_id, date_start_year, date_start_month, date_start_day,
            date_end_year, date_end_month, date_end_day,
            is_approximate, is_ongoing, note, sort_order)
        values (${indicatorId}, ${parameter.id}, ${numeric},
                ${value.text_value ?? null}, ${value.bool_value ?? null},
                (select o.id from app.parameter_options o
                  where o.parameter_id = ${parameter.id} and o.code = ${value.option ?? null}),
                ${entityAnswer(value)},
                ${value.date_start_year ?? null}, ${value.date_start_month ?? null},
                ${value.date_start_day ?? null}, ${value.date_end_year ?? null},
                ${value.date_end_month ?? null}, ${value.date_end_day ?? null},
                ${value.is_approximate ?? false}, ${value.is_ongoing ?? false},
                ${value.note ?? null}, ${position})
      `;
    }
  }
}

/**
 * Собственный текст записи — значение параметра «Текст» (Р-86). Пустой текст
 * значения не оставляет: отсутствие сведения — не значение.
 */
export async function writeText(tx: Tx, entityId: number, blocks: unknown[]) {
  await tx`
    delete from app.indicator_values v
     using app.indicators i, app.parameters p
     where v.indicator_id = i.id and p.id = v.parameter_id
       and i.entity_id = ${entityId} and p.code = 'text'
  `;
  await tx`
    delete from app.indicators i
     where i.entity_id = ${entityId} and i.title = 'Текст'
       and not exists (select 1 from app.indicator_values v where v.indicator_id = i.id)
  `;
  if (blocks.length === 0) return;
  const group = await tx<{ id: string }>`
    insert into app.indicators (entity_id, title, is_current, sort_order)
    values (${entityId}, 'Текст', true, 1000) returning id
  `;
  await tx`
    insert into app.indicator_values (indicator_id, parameter_id, blocks_value, sort_order)
    select ${group[0].id}, id, ${JSON.stringify(blocks)}::jsonb, 0
      from app.parameters where code = 'text'
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
             (select working_revision_id from app.entities where id = m.entity_id) as latest_revision_id
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

    await writeIndicators(tx, entityId, items);

    // Показатели — часть версии записи: правка создаёт редакцию (Р-78).
    // Снимок собирает база из рабочей копии, здесь его не составляем.
    let revisionId: string | null = null;
    if (material) {
      const revisions = await tx<{ id: string }>`
        insert into app.revisions (material_id, base_revision_id, edited_by, operation, summary, snapshot)
        values (${material.material_id}, ${material.latest_revision_id},
                ${principal.contributorId}, 'edit', 'Правка показателей', '{}'::jsonb)
        returning id
      `;
      revisionId = revisions[0].id;
    }

    return { items: await readAll(tx, entityId), revision_id: revisionId };
  });

  return c.json(result);
});
