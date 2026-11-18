import {readSetConfiguration,updateSetConfiguration} from '../lib/setConfiguration.ts';
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

/**
 * Виды ответа. «place» — ответ-запись из ветви «Где»: в базе это вид
 * «entity» с назначенной ветвью (Р-85), в интерфейсе — «место». «blocks» —
 * текст записи (Р-86).
 */
const VALUE_TYPES = ["number", "integer", "text", "boolean", "option", "date", "place", "blocks", "table"];

/** Вид ответа для базы: «место» хранится ответом-записью из ветви «Где». */
function storedType(type: string | undefined): string | null {
  if (type === undefined) return null;
  return type === "place" ? "entity" : type;
}
const CODE = /^[a-z0-9]+(_[a-z0-9]+)*$/;

interface ParameterInput {
  is_published?: boolean;
  code?: string;
  is_repeatable?: boolean;
  title_ru?: string;
  unit?: string | null;
  value_type?: string;
  definition?: string | null;
  sort_order?: number;
  /** parent — код родительского варианта: список вариантов может быть деревом. */
  options?: { code: string; title_ru: string; parent?: string | null }[];
}

function validate(input: ParameterInput, isCreate: boolean): void {
  if(input.is_published!==undefined&&typeof input.is_published!=='boolean')throw new ApiError('validation_failed','Опубликован: да или нет');
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
    select
           p.code as parameter, p.title_ru as title, p.unit, app.api_value_type(p.id) as value_type, p.definition,
           p.is_repeatable, p.is_published,
           case when p.row_set_id is not null then app.table_columns(p.id) end as columns,
           ps.code as set, ps.title_ru as set_title, i.hint, i.sort_order, ps.id as set_id, true as set_inherited, false as set_attached,
           -- Варианты могут быть деревом (классификатор помещений): у узла — код родителя.
           coalesce((select jsonb_agg(jsonb_build_object('code', o.code, 'title', o.title_ru,
                                                         'parent', (select po.code from app.parameter_options po where po.id = o.parent_id))
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
       -- Текст записи правится своим редактором, среди величин ему не место.
       and p.value_type <> 'blocks'
     order by ps.sort_order, ps.id, i.sort_order, p.id
  `;
  return c.json({ items: rows });
});

/** Справочник целиком: он невелик и нужен сразу весь. */
parameters.get("/", async (c: Context<AppEnv>) => {
  const rows = await sql`
    select p.id, p.code, p.title_ru, p.unit, app.api_value_type(p.id) as value_type, p.definition, p.sort_order,
           p.is_repeatable, p.is_published,
           case when p.row_set_id is not null then app.table_columns(p.id) end as columns,
           -- Варианты могут быть деревом (классификатор помещений): у узла — код родителя.
           coalesce((select jsonb_agg(jsonb_build_object('code', o.code, 'title', o.title_ru,
                                                         'parent', (select po.code from app.parameter_options po where po.id = o.parent_id))
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
      insert into app.parameters (code, title_ru, unit, value_type, definition, sort_order,
                                  is_repeatable,is_published)
      values (${input.code}, ${input.title_ru}, ${input.unit ?? null}, ${storedType(input.value_type)},
              ${input.definition ?? null}, ${input.sort_order ?? 0},
              ${input.is_repeatable ?? false},${input.is_published ?? true})
      returning id
    `;
    const id = rows[0].id;
    if (input.value_type === "place") {
      await tx`update app.parameters
                  set value_entity_type_id = (select id from app.entity_types where code = 'place')
                where id = ${id}`;
    }
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
      select app.api_value_type(p.id) as value_type,
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

    // Список значений правится вместе с параметром: добавить, переименовать,
    // убрать. Убрать можно только то, чем ещё не ответили, — значения дороже.
    if (input.options) {
      const keep: string[] = [];
      for (const [index, option] of input.options.entries()) {
        keep.push(option.code);
        await tx`
          insert into app.parameter_options (parameter_id, code, title_ru, sort_order)
          values (${id}, ${option.code}, ${option.title_ru}, ${index})
          on conflict (parameter_id, code)
          do update set title_ru = excluded.title_ru, sort_order = excluded.sort_order
        `;
      }
      // Родители — после того, как все варианты на месте: порядок в списке
      // не обязан идти от корня. Цикл и чужого родителя отклоняет база.
      for (const option of input.options) {
        if (option.parent === undefined) continue;
        await tx`
          update app.parameter_options set parent_id =
                 (select p.id from app.parameter_options p where p.parameter_id = ${id} and p.code = ${option.parent ?? null})
           where parameter_id = ${id} and code = ${option.code}
        `;
      }
      // Массивы драйверу передаём через jsonb: так же, как в остальных местах.
      const kept = JSON.stringify(keep);
      const used = await tx<{ title_ru: string }>`
        select o.title_ru from app.parameter_options o
         where o.parameter_id = ${id}
           and o.code <> all (select jsonb_array_elements_text(${kept}::jsonb))
           and exists (select 1 from app.indicator_values iv where iv.option_id = o.id)
      `;
      if (used.length > 0) {
        throw new ApiError(
          "validation_failed",
          `Значение «${used[0].title_ru}» уже выбрано в карточках: убрать нельзя`,
        );
      }
      await tx`
        delete from app.parameter_options
         where parameter_id = ${id}
           and code <> all (select jsonb_array_elements_text(${kept}::jsonb))
      `;
    }

    const rows = await tx`
      update app.parameters set
        is_published = coalesce(${input.is_published ?? null}, is_published),
        title_ru   = coalesce(${input.title_ru ?? null}, title_ru),
        unit       = coalesce(${input.unit ?? null}, unit),
        value_type = coalesce(${storedType(input.value_type)}, value_type),
        value_entity_type_id = case when ${input.value_type ?? null}::text = 'place'
                                    then (select id from app.entity_types where code = 'place')
                                    when ${input.value_type ?? null}::text is null then value_entity_type_id
                                    else null end,
        definition = coalesce(${input.definition ?? null}, definition),
        sort_order = coalesce(${input.sort_order ?? null}, sort_order)
      where id = ${id}
      returning id, code, title_ru, unit, app.api_value_type(id) as value_type, definition, sort_order
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
    select s.id, s.code, s.title_ru, s.note, s.sort_order, s.card_side,s.research_enabled,s.result_kind,s.config_version,(select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'title',t.title) order by t.sort_order,t.id),'[]') from app.parameter_set_research_tasks t where t.set_id=s.id and t.enabled) as research_tasks,
           coalesce((select jsonb_agg(jsonb_build_object(
                        'code', p.code, 'title_ru', p.title_ru, 'unit', p.unit,
                        'value_type', app.api_value_type(p.id), 'definition', p.definition,
                        'is_repeatable', p.is_repeatable, 'hint', i.hint)||to_jsonb(i)
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
  const input = await c.req.json<{ code: string; title_ru: string; note?: string | null; card_side?: string }>();
  if (!input.code || !CODE.test(input.code)) {
    throw new ApiError("validation_failed", "Код набора: строчные латинские буквы и цифры");
  }
  if (!input.title_ru) throw new ApiError("validation_failed", "Не указано название набора");

  if (input.card_side !== undefined && !["left", "right"].includes(input.card_side)) throw new ApiError("validation_failed", "Сторона карточки: left или right");

  const rows = await transaction(principal.contributorId, (tx) =>
    tx`
      insert into app.parameter_sets (code, title_ru, note, card_side)
      values (${input.code}, ${input.title_ru}, ${input.note ?? null}, ${input.card_side ?? "right"})
      returning id, code, title_ru, card_side, config_version
    `);
  return c.json(rows[0], 201);
});

/** Название и пояснение набора правятся тем же окном, что и создание. */
parameterSets.patch("/:code", async (c: Context<AppEnv>) => {
  const principal = requirePermission(c.get("principal"), "su");
  const code = c.req.param("code");
  const input = await c.req.json<{ title_ru?: string; note?: string | null; sort_order?: number; card_side?: string; config_version?:number }>();

  if (input.card_side !== undefined && !["left", "right"].includes(input.card_side)) throw new ApiError("validation_failed", "Сторона карточки: left или right");

  const rows = await transaction(principal.contributorId, (tx) =>
    tx`
      update app.parameter_sets set
        title_ru   = coalesce(${input.title_ru ?? null}, title_ru),
        note       = coalesce(${input.note ?? null}, note),
        sort_order = coalesce(${input.sort_order ?? null}, sort_order),
        card_side = coalesce(${input.card_side ?? null}, card_side)
      where (code = ${code} or id::text = ${code}) and (${input.config_version??null}::bigint is null or config_version=${input.config_version??null})
      returning id, code, title_ru, note, card_side, config_version
    `);
  if (rows.length === 0) throw new ApiError("version_conflict", "Набор изменился или удалён. Перечитайте настройки.");
  return c.json(rows[0]);
});

/** Обновление вхождений сохраняет настройки. Удаление только по явным UID. */
parameterSets.put("/:code/items", async (c: Context<AppEnv>) => {
  const principal = requirePermission(c.get("principal"), "su");
  const code = c.req.param("code");
  const input = await c.req.json<{ items: { parameter: string; hint?: string | null }[];remove_ids?:string[];config_version?:number }>();
  const items = input.items ?? [];

  const result = await transaction(principal.contributorId, async (tx) => {
    const sets = await tx<{ id: string;config_version:number }>`
      select id,config_version from app.parameter_sets where code = ${code} or id::text=${code} for update
    `;
    if (sets.length === 0) throw new ApiError("not_found", "Набор не найден");
    const setId = sets[0].id;
    if(input.config_version!=null&&String(input.config_version)!==String(sets[0].config_version))throw new ApiError('version_conflict','Настройки набора изменились');

    if ((input as any).remove_ids?.length) await tx`delete from app.parameter_set_items where set_id=${setId} and parameter_id=any(${(input as any).remove_ids}::uuid[])`;
    for (const [index, item] of items.entries()) {
      const found = await tx<{ id: string }>`
        select id from app.parameters where code = ${item.parameter} or id::text=${item.parameter}
      `;
      if (found.length === 0) {
        throw new ApiError("validation_failed", "Неизвестный параметр", {
          parameter: item.parameter,
        });
      }
      await tx`
        insert into app.parameter_set_items (set_id, parameter_id, sort_order, hint)
        values (${setId}, ${found[0].id}, ${index}, ${item.hint ?? null})
        on conflict(set_id,parameter_id) do update set sort_order=excluded.sort_order,hint=case when ${Object.hasOwn(item,'hint')} then excluded.hint else app.parameter_set_items.hint end
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
    const sets = await tx<{ id: string }>`select id from app.parameter_sets where code = ${code} or id::text = ${code}`;
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

/**
 * Набор у отдельной записи — исключение из наследования по дереву (Р-38):
 * музей в бывшем вокзале получает набор «Вокзал» вдобавок к своему,
 * а здание с большепролётным покрытием — набор покрытия, хотя тип у него
 * общий с домом без больших пролётов.
 */
parameterSets.post("/:code/entities", async (c: Context<AppEnv>) => {
  const principal = requirePermission(c.get("principal"), "edit");
  const code = c.req.param("code");
  const input = await c.req.json<{ entity_id: number }>();
  if (!Number.isInteger(input.entity_id)) {
    throw new ApiError("validation_failed", "Не указана запись");
  }

  const result = await transaction(principal.contributorId, async (tx) => {
    const sets = await tx<{ id: string }>`select id from app.parameter_sets where code = ${code} or id::text = ${code}`;
    if (sets.length === 0) throw new ApiError("not_found", "Набор не найден");
    const found = await tx<{ id: number }>`
      select id from app.entities where id = ${input.entity_id}
    `;
    if (found.length === 0) throw new ApiError("not_found", "Запись не найдена");

    await tx`
      insert into app.entity_parameter_sets (entity_id, set_id)
      values (${input.entity_id}, ${sets[0].id})
      on conflict do nothing
    `;
    return { set: code, entity_id: input.entity_id };
  });

  return c.json(result);
});

parameterSets.delete("/:code/entities/:id", async (c: Context<AppEnv>) => {
  const principal = requirePermission(c.get("principal"), "edit");
  const code = c.req.param("code");
  const entityId = Number(c.req.param("id"));

  if (!Number.isInteger(entityId)) throw new ApiError("validation_failed", "Неверный идентификатор записи");
  await transaction(principal.contributorId, async (tx) => {
    const [set] = await tx<{id:string}>`select id from app.parameter_sets where id::text=${code} or code=${code}`;
    if (!set) throw new ApiError("not_found", "Набор не найден");
    const [entity] = await tx<{id:number}>`select id from app.entities where id=${entityId} for update`;
    if (!entity) throw new ApiError("not_found", "Запись не найдена");
    const inherited = await tx`select 1 from app.entities e join app.type_parameter_sets t on t.type_id in(select app.entity_type_ancestors(e.type_id)) where e.id=${entityId} and t.set_id=${set.id}`;
    if (inherited.length) throw new ApiError("validation_failed", "Этот набор задан типом записи и не открепляется отдельно");
    // Only the attachment is removed. Values, revisions and research remain intact.
    await tx`delete from app.entity_parameter_sets where entity_id=${entityId} and set_id=${set.id}`;
  });
  return c.body(null, 204);
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

parameterSets.get('/:id/config',async c=>{requirePermission(c.get('principal'),'su');return c.json(await readSetConfiguration(c.req.param('id')));});
parameterSets.patch('/:id/config',async c=>{const actor=requirePermission(c.get('principal'),'su');return c.json(await updateSetConfiguration(c.req.param('id'),await c.req.json(),actor.contributorId!));});

parameterSets.post('/config',async c=>{const actor=requirePermission(c.get('principal'),'su');return c.json(await updateSetConfiguration(null,await c.req.json(),actor.contributorId!),201);});

parameterSets.get('/config/options',async c=>{requirePermission(c.get('principal'),'su');const types=await sql`select id,title_ru from app.entity_types order by title_ru`;const roles=await sql`select id,title_ru from app.link_roles order by title_ru`;return c.json({types,roles});});
