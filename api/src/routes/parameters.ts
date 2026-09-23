/**
 * Справочник параметров и наборы (решение Р-38).
 *
 * Параметр — определение величины: код, название, единица, тип значения и то,
 * что именно считается этой величиной. Набор — список параметров, привязанный
 * к узлу дерева типов; он действует и для всего, что ниже.
 *
 * Чтение открыто: без справочника не показать карточку. Ведение справочника
 * требует права `su` — иначе «вместимость зала» и «Вместимость (мест)»
 * заведутся порознь и сравнивать станет нечего.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { sql, transaction } from "../lib/db.ts";
import { ApiError } from "../lib/errors.ts";
import { require as requirePermission } from "../lib/auth.ts";
import type { AppEnv } from "../lib/http.ts";

export const parameters = new Hono<AppEnv>();
export const parameterSets = new Hono<AppEnv>();

const VALUE_TYPES = ["number", "integer", "text", "boolean", "option", "date"];
const CODE = /^[a-z0-9]+(_[a-z0-9]+)*$/;

interface ParameterInput {
  code?: string;
  title_ru?: string;
  unit?: string | null;
  value_type?: string;
  definition?: string | null;
  sort_order?: number;
  options?: { code: string; title_ru: string }[];
}

function validate(input: ParameterInput, isCreate: boolean): void {
  const problems: Record<string, string> = {};
  if (isCreate) {
    if (!input.code) problems.code = "Не указан код";
    if (!input.title_ru) problems.title_ru = "Не указано название";
    if (!input.value_type) problems.value_type = "Не указан тип значения";
  }
  if (input.code !== undefined && !CODE.test(input.code)) {
    problems.code = "Только строчные латинские буквы, цифры и подчёркивание";
  }
  if (input.value_type !== undefined && !VALUE_TYPES.includes(input.value_type)) {
    problems.value_type = `Тип значения: ${VALUE_TYPES.join(", ")}`;
  }
  if (input.value_type === "option" && isCreate && (input.options ?? []).length === 0) {
    problems.options = "Для выбора нужен список значений";
  }
  if (Object.keys(problems).length > 0) {
    throw new ApiError("validation_failed", "Проверьте заполнение полей", problems);
  }
}

/** Что подсказано типу: наборы его ветви сверху вниз (Р-38). */
parameters.get("/for-type/:code", async (c: Context<AppEnv>) => {
  const code = c.req.param("code");
  const rows = await sql`
    select distinct on (p.id)
           p.code as parameter, p.title_ru as title, p.unit, p.value_type, p.definition,
           ps.code as set, ps.title_ru as set_title, i.hint, i.sort_order,
           coalesce((select jsonb_agg(jsonb_build_object('code', o.code, 'title', o.title_ru)
                        order by o.sort_order)
                     from app.parameter_options o where o.parameter_id = p.id), '[]'::jsonb)
             as options
      from app.entity_types ty
      join app.parameter_sets ps
        on ps.id in (select tps.set_id from app.type_parameter_sets tps
                      where tps.type_id in (select app.entity_type_ancestors(ty.id)))
      join app.parameter_set_items i on i.set_id = ps.id
      join app.parameters p on p.id = i.parameter_id
     where ty.code = ${code}
     order by p.id, ps.sort_order, i.sort_order
  `;
  // Порядок показа — по набору и месту в нём, а не по внутреннему ключу.
  rows.sort((a, b) =>
    Number(a.sort_order) - Number(b.sort_order) ||
    String(a.title).localeCompare(String(b.title))
  );
  return c.json({ items: rows });
});

/** Справочник целиком: он невелик и нужен сразу весь. */
parameters.get("/", async (c: Context<AppEnv>) => {
  const rows = await sql`
    select p.id, p.code, p.title_ru, p.unit, p.value_type, p.definition, p.sort_order,
           coalesce((select jsonb_agg(jsonb_build_object('code', o.code, 'title', o.title_ru)
                        order by o.sort_order)
                     from app.parameter_options o where o.parameter_id = p.id), '[]'::jsonb)
             as options,
           (select count(*) from app.indicator_values iv where iv.parameter_id = p.id) as used
    from app.parameters p
    order by p.sort_order, p.title_ru
  `;
  return c.json({ items: rows });
});

parameters.post("/", async (c: Context<AppEnv>) => {
  const principal = requirePermission(c.get("principal"), "su");
  const input = await c.req.json<ParameterInput>();
  validate(input, true);

  const result = await transaction(principal.contributorId, async (tx) => {
    const rows = await tx<{ id: string }>`
      insert into app.parameters (code, title_ru, unit, value_type, definition, sort_order)
      values (${input.code}, ${input.title_ru}, ${input.unit ?? null}, ${input.value_type},
              ${input.definition ?? null}, ${input.sort_order ?? 0})
      returning id
    `;
    const id = rows[0].id;
    for (const [index, option] of (input.options ?? []).entries()) {
      await tx`
        insert into app.parameter_options (parameter_id, code, title_ru, sort_order)
        values (${id}, ${option.code}, ${option.title_ru}, ${index})
      `;
    }
    return { id };
  });

  return c.json(result, 201);
});

parameters.patch("/:id", async (c: Context<AppEnv>) => {
  const principal = requirePermission(c.get("principal"), "su");
  const id = c.req.param("id");
  const input = await c.req.json<ParameterInput>();
  validate(input, false);

  // Тип значения у заполненного параметра не меняем: прежние значения от этого
  // стали бы бессмысленными. Нужен другой тип — заводится другой параметр.
  const result = await transaction(principal.contributorId, async (tx) => {
    const current = await tx<{ value_type: string; used: string }>`
      select p.value_type,
             (select count(*) from app.indicator_values iv where iv.parameter_id = p.id) as used
        from app.parameters p where p.id = ${id}
    `;
    if (current.length === 0) throw new ApiError("not_found", "Параметр не найден");
    if (
      input.value_type && input.value_type !== current[0].value_type &&
      Number(current[0].used) > 0
    ) {
      throw new ApiError(
        "validation_failed",
        "У параметра есть заполненные значения: тип менять нельзя",
      );
    }

    const rows = await tx`
      update app.parameters set
        title_ru   = coalesce(${input.title_ru ?? null}, title_ru),
        unit       = coalesce(${input.unit ?? null}, unit),
        value_type = coalesce(${input.value_type ?? null}, value_type),
        definition = coalesce(${input.definition ?? null}, definition),
        sort_order = coalesce(${input.sort_order ?? null}, sort_order)
      where id = ${id}
      returning id, code, title_ru, unit, value_type, definition, sort_order
    `;
    return rows[0];
  });

  return c.json(result);
});

/** Удалить можно только незаполненный параметр: значения не теряем (правило 2). */
parameters.delete("/:id", async (c: Context<AppEnv>) => {
  const principal = requirePermission(c.get("principal"), "su");
  const id = c.req.param("id");

  await transaction(principal.contributorId, async (tx) => {
    const used = await tx<{ used: string }>`
      select count(*) as used from app.indicator_values where parameter_id = ${id}
    `;
    if (Number(used[0]?.used ?? 0) > 0) {
      throw new ApiError(
        "validation_failed",
        "У параметра есть заполненные значения: удалить нельзя",
      );
    }
    await tx`delete from app.parameter_set_items where parameter_id = ${id}`;
    await tx`delete from app.parameters where id = ${id}`;
  });

  return c.body(null, 204);
});

/** Наборы вместе с составом и узлами дерева, к которым они привязаны. */
parameterSets.get("/", async (c: Context<AppEnv>) => {
  const rows = await sql`
    select s.id, s.code, s.title_ru, s.note, s.sort_order,
           coalesce((select jsonb_agg(jsonb_build_object(
                        'code', p.code, 'title_ru', p.title_ru, 'unit', p.unit,
                        'value_type', p.value_type, 'hint', i.hint)
                        order by i.sort_order)
                     from app.parameter_set_items i
                     join app.parameters p on p.id = i.parameter_id
                    where i.set_id = s.id), '[]'::jsonb) as items,
           coalesce((select jsonb_agg(jsonb_build_object('code', ty.code, 'title', ty.title_ru)
                        order by ty.sort_order)
                     from app.type_parameter_sets tps
                     join app.entity_types ty on ty.id = tps.type_id
                    where tps.set_id = s.id), '[]'::jsonb) as types
    from app.parameter_sets s
    order by s.sort_order, s.title_ru
  `;
  return c.json({ items: rows });
});

parameterSets.post("/", async (c: Context<AppEnv>) => {
  const principal = requirePermission(c.get("principal"), "su");
  const input = await c.req.json<{ code: string; title_ru: string; note?: string | null }>();
  if (!input.code || !CODE.test(input.code)) {
    throw new ApiError("validation_failed", "Код набора: строчные латинские буквы и цифры");
  }
  if (!input.title_ru) throw new ApiError("validation_failed", "Не указано название набора");

  const rows = await transaction(principal.contributorId, (tx) =>
    tx`
      insert into app.parameter_sets (code, title_ru, note)
      values (${input.code}, ${input.title_ru}, ${input.note ?? null})
      returning id, code, title_ru
    `);
  return c.json(rows[0], 201);
});

/** Состав набора задаётся целиком: что прислали, то и осталось. */
parameterSets.put("/:code/items", async (c: Context<AppEnv>) => {
  const principal = requirePermission(c.get("principal"), "su");
  const code = c.req.param("code");
  const input = await c.req.json<{ items: { parameter: string; hint?: string | null }[] }>();
  const items = input.items ?? [];

  const result = await transaction(principal.contributorId, async (tx) => {
    const sets = await tx<{ id: string }>`
      select id from app.parameter_sets where code = ${code}
    `;
    if (sets.length === 0) throw new ApiError("not_found", "Набор не найден");
    const setId = sets[0].id;

    await tx`delete from app.parameter_set_items where set_id = ${setId}`;
    for (const [index, item] of items.entries()) {
      const found = await tx<{ id: string }>`
        select id from app.parameters where code = ${item.parameter}
      `;
      if (found.length === 0) {
        throw new ApiError("validation_failed", "Неизвестный параметр", {
          parameter: item.parameter,
        });
      }
      await tx`
        insert into app.parameter_set_items (set_id, parameter_id, sort_order, hint)
        values (${setId}, ${found[0].id}, ${index}, ${item.hint ?? null})
      `;
    }
    return { set: code, items: items.length };
  });

  return c.json(result);
});

/** Привязка набора к узлу дерева: действует и для всего, что ниже. */
parameterSets.post("/:code/types", async (c: Context<AppEnv>) => {
  const principal = requirePermission(c.get("principal"), "su");
  const code = c.req.param("code");
  const input = await c.req.json<{ type: string }>();

  const result = await transaction(principal.contributorId, async (tx) => {
    const sets = await tx<{ id: string }>`select id from app.parameter_sets where code = ${code}`;
    if (sets.length === 0) throw new ApiError("not_found", "Набор не найден");
    const types = await tx<{ id: string }>`
      select id from app.entity_types where code = ${input.type}
    `;
    if (types.length === 0) {
      throw new ApiError("validation_failed", "Неизвестный тип записи", { type: input.type });
    }
    await tx`
      insert into app.type_parameter_sets (type_id, set_id)
      values (${types[0].id}, ${sets[0].id})
      on conflict do nothing
    `;
    return { set: code, type: input.type };
  });

  return c.json(result);
});

parameterSets.delete("/:code/types/:type", async (c: Context<AppEnv>) => {
  const principal = requirePermission(c.get("principal"), "su");
  const code = c.req.param("code");
  const type = c.req.param("type");

  await transaction(principal.contributorId, (tx) =>
    tx`
      delete from app.type_parameter_sets tps
       using app.parameter_sets s, app.entity_types ty
       where tps.set_id = s.id and tps.type_id = ty.id
         and s.code = ${code} and ty.code = ${type}
    `);
  return c.body(null, 204);
});

/** Набор убирается целиком: состав и привязки к ветвям уходят вместе с ним. */
parameterSets.delete("/:code", async (c: Context<AppEnv>) => {
  const principal = requirePermission(c.get("principal"), "su");
  const code = c.req.param("code");

  await transaction(principal.contributorId, (tx) =>
    tx`delete from app.parameter_sets where code = ${code}`);
  return c.body(null, 204);
});
