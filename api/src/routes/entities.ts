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

export const entities = new Hono<AppEnv>();

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

interface EntityInput {
  kind: string;
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
    if (!input.kind) problems.kind = "Не указан вид сущности";
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

/** Снимок для версии: карточка вместе с профилем. */
async function snapshot(tx: Tx, id: number) {
  const rows = await tx`
    select to_jsonb(e) ||
           jsonb_build_object('profile', coalesce(
               to_jsonb(op) - 'entity_id' - 'kind_id',
               to_jsonb(pp) - 'entity_id' - 'kind_id',
               to_jsonb(rp) - 'entity_id' - 'kind_id',
               '{}'::jsonb)) as data
    from app.entities e
    left join app.object_profile op on op.entity_id = e.id
    left join app.person_profile pp on pp.entity_id = e.id
    left join app.period_profile rp on rp.entity_id = e.id
    where e.id = ${id}
  `;
  return (rows[0] as { data?: unknown })?.data ?? {};
}

entities.get("/", async (c: Context<AppEnv>) => {
  const principal = c.get("principal");
  const limit = pageSize(c.req.query("limit"));
  const after = decodeCursor(c.req.query("cursor"));
  const kind = c.req.query("kind") ?? null;
  const search = c.req.query("q")?.trim() || null;
  const drafts = canSeeDrafts(principal);
  // Архив в каталоге не показывается: он не «ещё не готово», а «убрано».
  // Найти убранное можно явным запросом ?archived=1 — для восстановления.
  const archived = c.req.query("archived") === "1" && drafts;

  const rows = await sql`
    select e.id, e.slug, e.title_ru, e.title_en, e.title_original, e.title_la,
           k.code as kind, e.is_published, e.sort_order, e.cover_media_id,
           m.status as material_status
    from app.entities e
    join app.entity_kinds k on k.id = e.kind_id
    left join app.materials m on m.entity_id = e.id
    where (${drafts} or e.is_published)
      and (${archived} or coalesce(m.status, 'draft') <> 'archived')
      and (${kind}::text is null or k.code = ${kind})
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
    select e.*, k.code as kind, m.id as material_id, m.status as material_status,
           m.published_revision_id,
           (select r.id from app.revisions r where r.material_id = m.id
             order by r.created_at desc limit 1) as latest_revision_id,
           coalesce(
             to_jsonb(op) - 'entity_id' - 'kind_id' - 'object_type_id'
               || jsonb_build_object(
                    'object_type', (select code from app.object_types t where t.id = op.object_type_id)),
             to_jsonb(pp) - 'entity_id' - 'kind_id' - 'person_type_id'
               || jsonb_build_object(
                    'person_type', (select code from app.person_types t where t.id = pp.person_type_id)),
             to_jsonb(rp) - 'entity_id' - 'kind_id', '{}'::jsonb) as profile,
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
                        order by a.sort_order)
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
    join app.entity_kinds k on k.id = e.kind_id
    left join app.materials m on m.entity_id = e.id
    left join app.object_profile op on op.entity_id = e.id
    left join app.person_profile pp on pp.entity_id = e.id
    left join app.period_profile rp on rp.entity_id = e.id
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
    const kinds = await tx`select id, code from app.entity_kinds where code = ${input.kind}`;
    if (kinds.length === 0) {
      throw new ApiError("validation_failed", "Неизвестный вид сущности", { kind: input.kind });
    }
    const kindId = kinds[0].id;

    const inserted = await tx`
      insert into app.entities (kind_id, slug, title_ru, title_original, original_language,
                                title_la, title_en, color, sort_order)
      values (${kindId}, ${input.slug}, ${input.title_ru}, ${input.title_original ?? null},
              ${input.original_language ?? null}, ${input.title_la ?? null},
              ${input.title_en ?? null}, ${input.color ?? null}, ${input.sort_order ?? 0})
      returning id
    `;
    const entityId = Number(inserted[0].id);

    if (input.kind === "object") {
      const profile = input.profile ?? {};
      await tx`
        insert into app.object_profile (entity_id, object_type_id, lat, lon, typology)
        values (${entityId},
                (select id from app.object_types where code = ${profile.object_type ?? null}),
                ${profile.lat ?? null}, ${profile.lon ?? null}, ${profile.typology ?? null})
      `;
    } else if (input.kind === "person") {
      const profile = input.profile ?? {};
      await tx`
        insert into app.person_profile (entity_id, person_type_id, full_name)
        values (${entityId},
                (select id from app.person_types where code = ${profile.person_type ?? null}),
                ${profile.full_name ?? null})
      `;
    } else if (input.kind === "period") {
      await tx`insert into app.period_profile (entity_id) values (${entityId})`;
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
        insert into app.slug_history (kind_id, slug, entity_id)
        select e.kind_id, e.slug, e.id from app.entities e
         where e.id = ${id} and e.slug <> ${input.slug}
        on conflict (kind_id, slug) do nothing
      `;
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

    // Профиль тоже правится: без этого город, адрес и тип молча оставались прежними.
    const profile = input.profile;
    if (profile) {
      await tx`
        update app.object_profile set
          object_type_id = coalesce(
            (select id from app.object_types where code = ${profile.object_type ?? null}),
            object_type_id),
          typology = coalesce(${profile.typology ?? null}, typology),
          lat      = coalesce(${profile.lat ?? null}, lat),
          lon      = coalesce(${profile.lon ?? null}, lon)
        where entity_id = ${id}
      `;
      await tx`
        update app.person_profile set
          person_type_id = coalesce(
            (select id from app.person_types where code = ${profile.person_type ?? null}),
            person_type_id),
          full_name = coalesce(${profile.full_name ?? null}, full_name)
        where entity_id = ${id}
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
