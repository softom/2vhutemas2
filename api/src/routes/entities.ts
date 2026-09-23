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

/** Снимок для версии: карточка вместе с типом и оставшимися свойствами. */
async function snapshot(tx: Tx, id: number) {
  const rows = await tx`
    select to_jsonb(e) ||
           jsonb_build_object(
             'type', ty.code,
             'type_path', app.entity_type_path(e.type_id),
             'profile', coalesce(to_jsonb(op) - 'entity_id', '{}'::jsonb)) as data
    from app.entities e
    join app.entity_types ty on ty.id = e.type_id
    left join app.object_profile op on op.entity_id = e.id
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
             order by a.sort_order, a.id limit 1) as cover_asset_id
    from app.entities e
    join app.entity_types ty on ty.id = e.type_id
    left join app.materials m on m.entity_id = e.id
    where (${drafts} or e.is_published)
      and (${archived} or coalesce(m.status, 'draft') <> 'archived')
      and (${type}::text is null
           or e.type_id in (select app.entity_type_subtree(${type})))
      and (${search}::text is null or e.title_ru ilike ${"%" + (search ?? "") + "%"}
           or e.title_en ilike ${"%" + (search ?? "") + "%"})
      and (${after}::bigint is null or e.id > ${after})
    order by e.id
    limit ${limit + 1}
  `;

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return c.json({
    items,
    next_cursor: hasMore ? encodeCursor(Number(items[items.length - 1].id)) : null,
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
           coalesce(to_jsonb(op) - 'entity_id', '{}'::jsonb) as profile,
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
           coalesce((select jsonb_agg(jsonb_build_object(
                        'attachment_id', a.id,
                        'role', ar.code, 'role_title', ar.title_ru,
                        'place_id', p.id,
                        'country', p.country, 'settlement', p.settlement,
                        'street', p.street, 'house', p.house, 'unit', p.unit,
                        'lat', p.lat, 'lon', p.lon, 'precision', p.precision)
                        order by a.sort_order, ar.sort_order)
                     from app.attachments a
                     join app.targets t on t.id = a.target_id
                     join app.attachment_roles ar on ar.id = a.role_id
                     join app.places p on p.id = a.place_id
                    where t.entity_id = e.id), '[]'::jsonb) as places,
           coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title)
                        order by t.title)
                     from app.entity_tags et join app.tags t on t.id = et.tag_id
                    where et.entity_id = e.id), '[]'::jsonb) as tags,
           (select jsonb_agg(jsonb_build_object(
                      'kind', dk.code, 'title', dk.title_ru,
                      'start_year', d.start_year, 'start_month', d.start_month,
                      'start_day', d.start_day, 'end_year', d.end_year,
                      'is_approximate', d.is_approximate, 'is_ongoing', d.is_ongoing,
                      'note', d.note)
                      order by d.sort_order, d.start_year)
            from app.entity_dates d join app.date_kinds dk on dk.id = d.kind_id
           where d.entity_id = e.id) as dates
    from app.entities e
    join app.entity_types ty on ty.id = e.type_id
    left join app.materials m on m.entity_id = e.id
    left join app.object_profile op on op.entity_id = e.id
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

    // Типология доживает до этапа Б, когда станет значением параметра.
    const typology = (input.profile?.typology as string | undefined) ?? null;
    if (typology) {
      await tx`
        insert into app.object_profile (entity_id, typology) values (${entityId}, ${typology})
      `;
    }

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

    // Типология правится и тогда, когда её ещё не было: иначе введённое
    // значение молча пропадало бы у записи без строки профиля.
    const typology = (input.profile?.typology as string | undefined) ?? null;
    if (typology) {
      await tx`
        insert into app.object_profile (entity_id, typology) values (${id}, ${typology})
        on conflict (entity_id) do update set typology = excluded.typology
      `;
    }

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
