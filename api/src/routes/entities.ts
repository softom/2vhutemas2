/**
 * Сущности: каталог, карточка, создание и изменение.
 *
 * Каждое изменение создаёт версию (Р-03): содержимое таблиц — текущее рабочее
 * состояние, revisions — неизменяемая история, materials.status — состояние
 * материала. Параллельная правка не затирается: клиент присылает версию,
 * от которой правил, и получает 409, если она устарела.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { sql, transaction, type Tx } from "../lib/db.ts";
import { ApiError } from "../lib/errors.ts";
import { canSeeDrafts, require as requirePermission } from "../lib/auth.ts";
import { type AppEnv, decodeCursor, encodeCursor, pageSize } from "../lib/http.ts";
import { resolveTypeCode, ROOT_TO_LEGACY_KIND } from "../lib/entityTypes.ts";

export const entities = new Hono<AppEnv>();

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

interface EntityInput {
  /** Код типа — узла дерева любой глубины (Р-37). */
  type?: string;
  /** Прежнее имя того же поля; принимается как псевдоним корневой ветви. */
  kind?: string;
  slug: string;
  title_ru: string;
  title_original?: string | null;
  original_language?: string | null;
  title_la?: string | null;
  title_en?: string | null;
  color?: string | null;
  sort_order?: number;
  profile?: Record<string, unknown>;
}

function validate(input: Partial<EntityInput>, isCreate: boolean): void {
  const problems: Record<string, string> = {};
  if (isCreate) {
    if (!input.type && !input.kind) problems.type = "Не указан тип записи";
    if (!input.slug) problems.slug = "Не указан адрес";
    if (!input.title_ru) problems.title_ru = "Не указано название";
  }
  if (input.slug !== undefined && !SLUG.test(input.slug)) {
    problems.slug = "Только строчные латинские буквы, цифры и дефис";
  }
  if (input.title_ru !== undefined && input.title_ru.trim() === "") {
    problems.title_ru = "Название не может быть пустым";
  }
  if (Object.keys(problems).length > 0) {
    throw new ApiError("validation_failed", "Проверьте заполнение полей", problems);
  }
}

/**
 * Типология из прежнего профиля: теперь это значение параметра `typology`
 * в показателях записи. Поле принимается ради выданных ранее сценариев.
 */
async function writeTypology(tx: Tx, entityId: number, typology: string | null): Promise<void> {
  if (!typology) return;
  const indicators = await tx<{ id: string }>`
    select id from app.indicators where entity_id = ${entityId} order by sort_order, id limit 1
  `;
  const indicatorId = indicators.length > 0 ? indicators[0].id : (await tx<{ id: string }>`
    insert into app.indicators (entity_id, title) values (${entityId}, 'Сведения') returning id
  `)[0].id;
  await tx`
    insert into app.indicator_values (indicator_id, parameter_id, text_value)
    select ${indicatorId}, p.id, ${typology} from app.parameters p where p.code = 'typology'
    on conflict (indicator_id, parameter_id) do update set text_value = excluded.text_value
  `;
}

/** Снимок для версии: карточка вместе с типом и показателями. */
async function snapshot(tx: Tx, id: number) {
  const rows = await tx`
    select to_jsonb(e) ||
           jsonb_build_object(
             'type', ty.code,
             'type_path', app.entity_type_path(e.type_id),
             'indicators', coalesce((select jsonb_agg(to_jsonb(i) order by i.sort_order)
                                     from app.indicators i where i.entity_id = e.id),
                                    '[]'::jsonb)) as data
    from app.entities e
    join app.entity_types ty on ty.id = e.type_id
    where e.id = ${id}
  `;
  return (rows[0] as { data?: unknown })?.data ?? {};
}

entities.get("/", async (c: Context<AppEnv>) => {
  const principal = c.get("principal");
  const limit = pageSize(c.req.query("limit"));
  const after = decodeCursor(c.req.query("cursor"));
  // Отбор идёт по ветви дерева целиком: «всё под ветвью Кто» — это прежний
  // фильтр по виду, «зрелищные здания» — ветвь ниже. Механизм один (Р-37).
  const type = resolveTypeCode(c.req.query("type"), c.req.query("kind"));
  const search = c.req.query("q")?.trim() || null;
  // Сортировка и отбор по величине — то, ради чего заведены параметры (Р-38).
  // Считаем по действующим показателям: иначе «по проекту» и «после
  // реконструкции» дали бы два разных ответа на один вопрос.
  const parameter = c.req.query("parameter") ?? null;
  const min = c.req.query("min") ? Number(c.req.query("min")) : null;
  const max = c.req.query("max") ? Number(c.req.query("max")) : null;
  const sortByValue = c.req.query("sort") === "parameter" && parameter !== null;
  const descending = c.req.query("order") === "desc";
  const drafts = canSeeDrafts(principal);
  // Архив в каталоге не показывается: он не «ещё не готово», а «убрано».
  // Найти убранное можно явным запросом ?archived=1 — для восстановления.
  const archived = c.req.query("archived") === "1" && drafts;

  const rows = await sql`
    select e.id, e.slug, e.title_ru, e.title_en, e.title_original, e.title_la,
           ty.code as type, ty.title_ru as type_title,
           app.entity_type_path(e.type_id) as type_path,
           e.is_published, e.sort_order,
           m.status as material_status,
           -- Обложка — первое по порядку прикреплённое изображение (решение Р-36).
           (select a.asset_id from app.attachments a
              join app.targets t on t.id = a.target_id
             where t.entity_id = e.id and a.asset_id is not null
             order by a.sort_order, a.id limit 1) as cover_asset_id,
           pv.num_value as parameter_value, pv.text_value as parameter_text
    from app.entities e
    join app.entity_types ty on ty.id = e.type_id
    left join app.materials m on m.entity_id = e.id
    left join lateral (
        select iv.num_value, iv.text_value
          from app.indicator_values iv
          join app.indicators i on i.id = iv.indicator_id
          join app.parameters p on p.id = iv.parameter_id
         where i.entity_id = e.id and i.is_current and p.code = ${parameter}
         order by i.sort_order limit 1) pv on ${parameter}::text is not null
    where (${drafts} or e.is_published)
      and (${archived} or coalesce(m.status, 'draft') <> 'archived')
      and (${type}::text is null
           or e.type_id in (select app.entity_type_subtree(${type})))
      and (${search}::text is null or e.title_ru ilike ${"%" + (search ?? "") + "%"}
           or e.title_en ilike ${"%" + (search ?? "") + "%"})
      and (${parameter}::text is null
           or pv.num_value is not null or pv.text_value is not null)
      and (${min}::numeric is null or pv.num_value >= ${min})
      and (${max}::numeric is null or pv.num_value <= ${max})
      and (${sortByValue} or ${after}::bigint is null or e.id > ${after})
    order by case when ${sortByValue} and ${descending} then pv.num_value end desc nulls last,
             case when ${sortByValue} and not ${descending} then pv.num_value end asc nulls last,
             e.id
    limit ${limit + 1}
  `;

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return c.json({
    items,
    next_cursor: hasMore && !sortByValue
      ? encodeCursor(Number(items[items.length - 1].id))
      : null,
  });
});

entities.get("/:id", async (c: Context<AppEnv>) => {
  const principal = c.get("principal");
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) throw new ApiError("validation_failed", "Неверный идентификатор");

  const rows = await sql`
    select e.*, ty.code as type, ty.title_ru as type_title,
           app.entity_type_path(e.type_id) as type_path,
           m.id as material_id, m.status as material_status,
           m.published_revision_id,
           (select r.id from app.revisions r where r.material_id = m.id
             order by r.created_at desc limit 1) as latest_revision_id,
           (select a.document_id from app.attachments a
              join app.targets t on t.id = a.target_id
              join app.attachment_roles ar on ar.id = a.role_id
             where t.entity_id = e.id and a.document_id is not null
               and ar.code in ('description', 'wiki')
             order by a.sort_order limit 1) as description_document_id,
           coalesce((select jsonb_agg(jsonb_build_object(
                        'attachment_id', a.id, 'asset_id', a.asset_id,
                        'role', ar.code, 'role_title', ar.title_ru,
                        'caption', ma.caption_ru, 'kind',
                        (select mk.code from app.media_kinds mk where mk.id = ma.kind_id),
                        'sort_order', a.sort_order)
                        order by a.sort_order, a.id)
                     from app.attachments a
                     join app.targets t on t.id = a.target_id
                     join app.attachment_roles ar on ar.id = a.role_id
                     join app.media_assets ma on ma.id = a.asset_id
                    where t.entity_id = e.id and a.asset_id is not null), '[]'::jsonb) as media,
           coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title)
                        order by t.title)
                     from app.entity_tags et join app.tags t on t.id = et.tag_id
                    where et.entity_id = e.id), '[]'::jsonb) as tags,
           coalesce((select jsonb_agg(jsonb_build_object(
                        'id', i.id, 'title', i.title, 'is_current', i.is_current,
                        'measured_year', i.measured_year, 'measured_by', i.measured_by,
                        'note', i.note,
                        'values', coalesce((select jsonb_agg(jsonb_build_object(
                               'parameter', p.code, 'title', p.title_ru, 'unit', p.unit,
                               'value_type', p.value_type,
                               'num_value', iv.num_value, 'text_value', iv.text_value,
                               'bool_value', iv.bool_value,
                               'option', (select o.code from app.parameter_options o
                                           where o.id = iv.option_id),
                               'option_title', (select o.title_ru from app.parameter_options o
                                                 where o.id = iv.option_id),
                               'place', (select to_jsonb(pl) from app.places pl
                                          where pl.id = iv.place_id),
                               'date_start_year', iv.date_start_year,
                               'date_end_year', iv.date_end_year,
                               'is_approximate', iv.is_approximate,
                               'is_ongoing', iv.is_ongoing, 'note', iv.note)
                               order by p.sort_order, p.title_ru, iv.sort_order)
                            from app.indicator_values iv
                            join app.parameters p on p.id = iv.parameter_id
                           where iv.indicator_id = i.id), '[]'::jsonb))
                        order by i.sort_order, i.id)
                     from app.indicators i where i.entity_id = e.id), '[]'::jsonb) as indicators,
           -- Что подсказывает ветвь дерева и собственные наборы записи (Р-38).
           coalesce((select jsonb_agg(jsonb_build_object(
                        'parameter', ep.code, 'title', ep.title_ru, 'unit', ep.unit,
                        'value_type', ep.value_type, 'definition', ep.definition,
                        'is_repeatable', (select pr.is_repeatable from app.parameters pr
                                           where pr.id = ep.parameter_id),
                        'set', ep.set_code, 'set_title', ep.set_title, 'hint', ep.hint,
                        'options', coalesce((select jsonb_agg(jsonb_build_object(
                                         'code', o.code, 'title', o.title_ru)
                                         order by o.sort_order)
                                      from app.parameter_options o
                                     where o.parameter_id = ep.parameter_id), '[]'::jsonb))
                        order by ep.sort_order, ep.title_ru)
                     from app.entity_parameters(e.id) ep), '[]'::jsonb) as suggested_parameters
    from app.entities e
    join app.entity_types ty on ty.id = e.type_id
    left join app.materials m on m.entity_id = e.id
    where e.id = ${id}
  `;
  const entity = rows[0];
  if (!entity) throw new ApiError("not_found", "Сущность не найдена");
  if (!entity.is_published && !canSeeDrafts(principal)) {
    throw new ApiError("not_found", "Сущность не найдена");
  }
  return c.json(entity);
});

entities.post("/", async (c: Context<AppEnv>) => {
  const principal = requirePermission(c.get("principal"), "create_delete");
  const input = await c.req.json<EntityInput>();
  validate(input, true);

  const result = await transaction(principal.contributorId, async (tx) => {
    const typeCode = resolveTypeCode(input.type, input.kind);
    const types = await tx`select id, code from app.entity_types where code = ${typeCode}`;
    if (types.length === 0) {
      throw new ApiError("validation_failed", "Неизвестный тип записи", { type: typeCode });
    }
    const typeId = types[0].id;

    const inserted = await tx`
      insert into app.entities (type_id, slug, title_ru, title_original, original_language,
                                title_la, title_en, color, sort_order)
      values (${typeId}, ${input.slug}, ${input.title_ru}, ${input.title_original ?? null},
              ${input.original_language ?? null}, ${input.title_la ?? null},
              ${input.title_en ?? null}, ${input.color ?? null}, ${input.sort_order ?? 0})
      returning id
    `;
    const entityId = Number(inserted[0].id);

    // Прежнее `profile.typology` принимается и ложится значением параметра:
    // выданные сценарии наполнения продолжают работать (Р-38).
    await writeTypology(tx, entityId, (input.profile?.typology as string | undefined) ?? null);

    const materials = await tx`
      insert into app.materials (kind, entity_id, created_by)
      values ('entity', ${entityId}, ${principal.contributorId})
      returning id
    `;
    const materialId = materials[0].id;

    await tx`
      insert into app.material_credits (material_id, contributor_id, credit_role)
      values (${materialId}, ${principal.contributorId}, 'author')
    `;

    const data = await snapshot(tx, entityId);
    const revisions = await tx`
      insert into app.revisions (material_id, edited_by, operation, summary, snapshot)
      values (${materialId}, ${principal.contributorId}, 'create', 'Создание карточки', ${JSON.stringify(data)}::jsonb)
      returning id
    `;

    return { id: entityId, material_id: materialId, revision_id: revisions[0].id };
  });

  c.header("location", `/api/v1/entities/${result.id}`);
  return c.json(result, 201);
});

entities.patch("/:id", async (c: Context<AppEnv>) => {
  const principal = requirePermission(c.get("principal"), "edit");
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) throw new ApiError("validation_failed", "Неверный идентификатор");

  const input = await c.req.json<Partial<EntityInput> & { base_revision_id?: string }>();
  validate(input, false);

  const baseRevisionId = input.base_revision_id ?? c.req.header("if-match") ?? null;
  if (!baseRevisionId) {
    throw new ApiError(
      "validation_failed",
      "Укажите версию, от которой выполняется правка (base_revision_id)",
    );
  }

  return c.json(await transaction(principal.contributorId, async (tx) => {
    const current = await tx`
      select m.id as material_id,
             (select r.id from app.revisions r where r.material_id = m.id
               order by r.created_at desc limit 1) as latest_revision_id
      from app.materials m where m.entity_id = ${id}
      for update
    `;
    if (current.length === 0) throw new ApiError("not_found", "Сущность не найдена");

    const { material_id, latest_revision_id } = current[0];
    if (latest_revision_id && latest_revision_id !== baseRevisionId) {
      throw new ApiError(
        "version_conflict",
        "Материал изменён другим редактором. Перечитайте карточку и повторите правку.",
        { latest_revision_id },
      );
    }

    if (input.slug) {
      await tx`
        insert into app.slug_history (slug, entity_id)
        select e.slug, e.id from app.entities e
         where e.id = ${id} and e.slug <> ${input.slug}
        on conflict (slug) do nothing
      `;
    }

    // Тип можно сменить: запись одна, меняется только ветвь дерева (Р-37).
    const typeCode = resolveTypeCode(input.type, input.kind);
    if (typeCode) {
      const types = await tx`select id from app.entity_types where code = ${typeCode}`;
      if (types.length === 0) {
        throw new ApiError("validation_failed", "Неизвестный тип записи", { type: typeCode });
      }
      await tx`update app.entities set type_id = ${types[0].id} where id = ${id}`;
    }

    await tx`
      update app.entities set
        slug              = coalesce(${input.slug ?? null}, slug),
        title_ru          = coalesce(${input.title_ru ?? null}, title_ru),
        title_original    = coalesce(${input.title_original ?? null}, title_original),
        original_language = coalesce(${input.original_language ?? null}, original_language),
        title_la          = coalesce(${input.title_la ?? null}, title_la),
        title_en          = coalesce(${input.title_en ?? null}, title_en),
        color             = coalesce(${input.color ?? null}, color),
        sort_order        = coalesce(${input.sort_order ?? null}, sort_order)
      where id = ${id}
    `;

    await writeTypology(tx, id, (input.profile?.typology as string | undefined) ?? null);

    const data = await snapshot(tx, id);
    const revisions = await tx`
      insert into app.revisions (material_id, base_revision_id, edited_by, operation, summary, snapshot)
      values (${material_id}, ${latest_revision_id}, ${principal.contributorId}, 'edit',
              ${"Правка карточки"}, ${JSON.stringify(data)}::jsonb)
      returning id
    `;
    return { id, material_id, revision_id: revisions[0].id };
  }));
});
