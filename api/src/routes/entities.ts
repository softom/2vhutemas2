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
import { entityAuthors, resolveEntity } from "../lib/publicCard.ts";
import { absolute, citation, entityPath } from "../lib/site.ts";
import { publishOwnerRevision } from "../lib/ownedVersions.ts";
import { notifyIndexNow } from "./pages.ts";

import { validateDocument, saveRefs } from "./documents.ts";
import { writeIndicators, writeText, type IndicatorInput } from "./indicators.ts";
import { writeEntityTags } from "./tags.ts";

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
  body_json?: unknown;
  indicators?: IndicatorInput[];
  tags?: string[];
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
  await tx`delete from app.indicator_values where indicator_id=${indicatorId}
    and parameter_id=(select id from app.parameters where code='typology')`;
  await tx`
    insert into app.indicator_values (indicator_id, parameter_id, text_value)
    select ${indicatorId}, p.id, ${typology} from app.parameters p where p.code = 'typology'

  `;
}

/**
 * Снимок рабочей копии записи. Присланный текст сначала ложится значением
 * параметра «Текст» (Р-86): снимок всегда собирается из значений, а не из
 * того, что прислал клиент. Не прислали текст — он остаётся прежним.
 */
async function snapshot(tx: Tx, id: number, body?: unknown) {
  if (body !== undefined) await writeText(tx, id, validateDocument(body));
  const rows = await tx`select app.entity_snapshot(${id}) as data`;
  return rows[0].data;
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
  // Какие величины показать в списке: страница лекций просит номер и курс.
  const wanted = JSON.stringify(
    (c.req.query("values") ?? "").split(",").map((code) => code.trim()).filter(Boolean),
  );
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
           e.status as material_status,
           -- Обложка — первое по порядку прикреплённое изображение (решение Р-36),
           -- но только то, которое спрашивающий может увидеть: иначе карточка
           -- обещает картинку, а на её месте выходит битый значок (Р-68).
           -- Иллюстрации — связи с записями «Изображение» (Р-84).
           app.cover_asset(e.id, ${drafts}) as cover_asset_id,
           pv.num_value as parameter_value, pv.text_value as parameter_text,
           coalesce((
             select jsonb_object_agg(v.code, v.value)
               from (select distinct on (p.code) p.code,
                            coalesce(to_jsonb(iv.num_value), to_jsonb(iv.text_value),
                                     to_jsonb(o.title_ru), to_jsonb(iv.date_start_year),
                                     to_jsonb(iv.bool_value)) as value
                       from app.read_values(${drafts}) iv
                       join app.read_indicators(${drafts}) i on i.id = iv.indicator_id
                       join app.parameters p on p.id = iv.parameter_id
                       left join app.parameter_options o on o.id = iv.option_id
                      where i.entity_id = e.id and i.is_current
                        and p.code in (select jsonb_array_elements_text(${wanted}::jsonb))
                      order by p.code, i.sort_order, iv.sort_order) v),
             '{}'::jsonb) as values
    from app.read_entities(${drafts}) e
    join app.entity_types ty on ty.id = e.type_id
    left join app.materials m on m.entity_id = e.id
    left join lateral (
        select iv.num_value, iv.text_value
          from app.read_values(${drafts}) iv
          join app.read_indicators(${drafts}) i on i.id = iv.indicator_id
          join app.parameters p on p.id = iv.parameter_id
         where i.entity_id = e.id and i.is_current and p.code = ${parameter}
         order by i.sort_order limit 1) pv on ${parameter}::text is not null
    where (${drafts} or e.is_published)
      and (${archived} or e.status <> 'archived')
      and (${type}::text is null
           or e.type_id in (select app.entity_type_subtree(${type})))
      -- Тексты интерфейса проекта показываются в «О проекте», а изображения
      -- и документы — материалы о записях — в медиатеке и самих карточках:
      -- в общем каталоге они заслонили бы предметы (Р-84).
      and (${type}::text is not null or e.type_id not in
           (select app.entity_type_subtree('project_pages')
            union select app.entity_type_subtree('materials')))
      and (${search}::text is null or e.title_ru ilike ${"%" + (search ?? "") + "%"}
           or e.title_en ilike ${"%" + (search ?? "") + "%"})
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
  const drafts = canSeeDrafts(principal);
  // Запись ищется и по номеру, и по адресу — текущему или прежнему (Р-65):
  // адрес страницы теперь слаг, а в текстах и старых ссылках лежат номера.
  const key = c.req.param("id") ?? "";
  const resolved = /^\d+$/.test(key) ? null : await resolveEntity(key, drafts);
  const id = resolved ? resolved.id : Number(key);
  if (!Number.isInteger(id)) throw new ApiError("not_found", "Сущность не найдена");

  const rows = await sql`
    select e.*, ty.code as type, ty.title_ru as type_title,
           app.entity_type_path(e.type_id) as type_path,
           m.id as material_id, e.status as material_status,
           e.working_revision_id as latest_revision_id,
           greatest(e.updated_at, (select r.created_at from app.revisions r
                                    where r.id = case when ${drafts} then e.working_revision_id else e.published_revision_id end)) as modified_at,
           e.legacy_description_id as description_document_id,
           (select r.snapshot->'body_json' from app.revisions r where r.id=
             case when ${drafts} then e.working_revision_id else e.published_revision_id end) as body_json,
           app.illustrations_json(e.id, ${drafts}) as media,
           coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title)
                        order by t.title)
                     from app.read_entity_tags(${drafts}) et join app.tags t on t.id = et.tag_id
                    where et.entity_id = e.id), '[]'::jsonb) as tags,
           coalesce((select jsonb_agg(jsonb_build_object(
                        'id', i.id, 'title', i.title, 'is_current', i.is_current,
                        'measured_year', i.measured_year, 'measured_by', i.measured_by,
                        'source_entity_id', i.source_entity_id, 'note', i.note,
                        'values', coalesce((select jsonb_agg(jsonb_build_object(
                               'parameter', p.code, 'title', p.title_ru, 'unit', p.unit,
                               'value_type', app.api_value_type(p.id),
                               'num_value', iv.num_value, 'text_value', iv.text_value,
                               'bool_value', iv.bool_value,
                               'option', (select o.code from app.parameter_options o
                                           where o.id = iv.option_id),
                               'option_title', (select o.title_ru from app.parameter_options o
                                                 where o.id = iv.option_id),
                               -- Ответ-запись: место приходит сведениями той
                               -- редакции, которую видит спрашивающий (Р-85).
                               'place', case when iv.entity_value_id is not null
                                             then app.place_json(iv.entity_value_id, ${drafts}) end,
                               'place_id', iv.entity_value_id::text,
                               'entity_value_id', iv.entity_value_id, 'date_start_month', iv.date_start_month, 'date_start_day', iv.date_start_day, 'date_end_month', iv.date_end_month, 'date_end_day', iv.date_end_day, 'date_start_year', iv.date_start_year,
                               'date_end_year', iv.date_end_year,
                               'is_approximate', iv.is_approximate,
                               'is_ongoing', iv.is_ongoing, 'note', iv.note)
                               order by p.sort_order, p.title_ru, iv.sort_order)
                            from app.read_values(${drafts}) iv
                            join app.parameters p on p.id = iv.parameter_id
                           where iv.indicator_id = i.id and p.value_type <> 'blocks'), '[]'::jsonb))
                        order by i.sort_order, i.id)
                     from app.read_indicators(${drafts}) i
                    where i.entity_id = e.id
                      and exists (select 1 from app.read_values(${drafts}) x
                                   join app.parameters xp on xp.id = x.parameter_id
                                  where x.indicator_id = i.id and xp.value_type <> 'blocks')), '[]'::jsonb) as indicators,
           -- Что подсказывает ветвь дерева и собственные наборы записи (Р-38).
           coalesce((select jsonb_agg(jsonb_build_object(
                        'parameter', ep.code, 'title', ep.title_ru, 'unit', ep.unit,
                        'value_type', app.api_value_type(ep.parameter_id), 'definition', ep.definition,
                        'is_repeatable', (select pr.is_repeatable from app.parameters pr
                                           where pr.id = ep.parameter_id),
                        'set', ep.set_code, 'set_title', ep.set_title, 'hint', ep.hint,
                        'options', coalesce((select jsonb_agg(jsonb_build_object(
                                         'code', o.code, 'title', o.title_ru)
                                         order by o.sort_order)
                                      from app.parameter_options o
                                     where o.parameter_id = ep.parameter_id), '[]'::jsonb))
                        order by ep.sort_order, ep.title_ru)
                     from app.entity_parameters(e.id) ep
                    where ep.value_type <> 'blocks'), '[]'::jsonb) as suggested_parameters
    from app.read_entities(${drafts}) e
    join app.entity_types ty on ty.id = e.type_id
    left join app.materials m on m.entity_id = e.id
    where e.id = ${id}
  `;
  const entity = rows[0];
  if (!entity) throw new ApiError("not_found", "Сущность не найдена");
  if (!entity.is_published && !drafts) {
    throw new ApiError("not_found", "Сущность не найдена");
  }

  // Источники — связи «источник» с книгами, статьями, веб-страницами (Р-80).
  // Гостю — опубликованные.
  const sourceRows = await sql<{ items: unknown[] }>`select app.sources_json(${id}, ${drafts}) as items`;
  const sources = sourceRows[0]?.items ?? [];
  const authors = await entityAuthors(id);
  // Год в ссылке — год последней правки: страница меняется, и так же
  // его считает готовая страница сайта.
  const year = new Date(String(entity.modified_at ?? new Date().toISOString())).getFullYear();
  const slug = String(entity.slug);
  return c.json({
    ...entity,
    sources,
    authors,
    canonical_url: absolute(entityPath(slug)),
    citation: citation({ title: String(entity.title_ru), slug, authors, year }),
  });
});

/**
 * Что подсказано этой записи: наборы её ветви плюс прикреплённые лично ей.
 * Для новой записи подсказки берутся по типу — `/parameters/for-type/{код}`.
 */
entities.get("/:id/parameters", async (c: Context<AppEnv>) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) throw new ApiError("validation_failed", "Неверный идентификатор");

  const rows = await sql`
    select ep.code as parameter, ep.title_ru as title, ep.unit,
           app.api_value_type(ep.parameter_id) as value_type, ep.definition,
           ep.set_code as set, ep.set_title, ep.hint, ep.sort_order,
           (select pr.is_repeatable from app.parameters pr where pr.id = ep.parameter_id)
             as is_repeatable,
           coalesce((select jsonb_agg(jsonb_build_object('code', o.code, 'title', o.title_ru)
                        order by o.sort_order)
                     from app.parameter_options o where o.parameter_id = ep.parameter_id),
                    '[]'::jsonb) as options
      from app.entity_parameters(${id}) ep
     where ep.value_type <> 'blocks'
     order by ep.sort_order, ep.title_ru
  `;
  return c.json({ items: rows });
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

    if (input.indicators !== undefined) await writeIndicators(tx, entityId, input.indicators);
    if (input.tags !== undefined) await writeEntityTags(tx, entityId, input.tags);
    const data = await snapshot(tx, entityId, input.body_json);
    const revisions = await tx`
      insert into app.revisions (material_id, edited_by, operation, summary, snapshot)
      values (${materialId}, ${principal.contributorId}, 'create', 'Создание карточки', ${JSON.stringify(data)}::jsonb)
      returning id
    `;

    await saveRefs(tx, String(revisions[0].id), (data as {body_json:unknown}).body_json);
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
             (select working_revision_id from app.entities where id=m.entity_id) as latest_revision_id
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

    if (input.indicators !== undefined) await writeIndicators(tx, id, input.indicators);
    if (input.tags !== undefined) await writeEntityTags(tx, id, input.tags);
    const data = await snapshot(tx, id, input.body_json);
    const revisions = await tx`
      insert into app.revisions (material_id, base_revision_id, edited_by, operation, summary, snapshot)
      values (${material_id}, ${latest_revision_id}, ${principal.contributorId}, 'edit',
              ${"Правка карточки"}, ${JSON.stringify(data)}::jsonb)
      returning id
    `;
    await saveRefs(tx, String(revisions[0].id), (data as {body_json:unknown}).body_json);
    return { id, material_id, revision_id: revisions[0].id };
  }));
});


/** История одного владельца, включая прежние отдельные редакции его текста. */
/**
 * Публикация записи: публикуется она целиком — сведения, параметры, метки и
 * собственный текст одной редакцией (Р-78). Прежний путь через материал
 * оставлен для независимых медиа и документов.
 */
entities.post("/:id/publish", async (c: Context<AppEnv>) => {
  const principal = requirePermission(c.get("principal"), "publish");
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) throw new ApiError("not_found", "Запись не найдена");
  const input = await c.req.json<{ revision_id?: string; note?: string }>()
    .catch(() => ({} as { revision_id?: string; note?: string }));

  const result = await transaction(principal.contributorId, (tx) =>
    publishOwnerRevision(tx, { kind: "entity", id }, input.revision_id,
                         principal.contributorId, input.note ?? null));

  // Поисковику сообщаем только о том, что действительно стало публичным.
  const rows = await sql<{ slug: string }>`
    select slug from app.entities where id = ${id} and is_published
  `;
  if (rows.length > 0) notifyIndexNow(c.get("requestId"), [entityPath(rows[0].slug)]);
  return c.json({ entity_id: id, ...result });
});

entities.get("/:id/versions", async (c: Context<AppEnv>) => {
  const principal=c.get("principal");
  if (!canSeeDrafts(principal)) throw new ApiError("permission_denied","История доступна редактору");
  const id=Number(c.req.param("id"));
  const rows=await sql`select r.id,r.created_at,r.summary,r.schema_version,
    r.id=e.published_revision_id as is_public,r.id=e.working_revision_id as is_working,
    c.display_name as editor,r.entity_id is not null and r.schema_version=2 as complete
    from app.entities e join app.revisions r on r.entity_id=e.id or r.material_id in
      (select m.id from app.materials m join app.documents d on d.id = m.document_id
        where d.owner_entity_id = e.id)
    left join app.contributors c on c.id=r.edited_by
    where e.id=${id} order by r.created_at desc,r.id limit 100`;
  return c.json({items:rows});
});
