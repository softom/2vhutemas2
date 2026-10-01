/**
 * Медиатека: загрузка оригинала, состояние производных, выдача файлов.
 *
 * Изображение — запись типа «Изображение» (Р-84). Подпись — её название,
 * автор, правообладатель, источник, лицензия, вид — значения параметров
 * набора «Изображение — сведения», публикация — публикация записи. Реестр
 * `media_assets` хранит только сам файл и его варианты; номер файла (UID)
 * по-прежнему идёт в адресах и в блоках текста `mediaImage`.
 *
 * Прикрепление изображения к записи — связь «иллюстрация»: порядок и обложка
 * у связи, подпись к этому месту — её обоснование. Маршруты /media/attachments
 * остались прежними, номер привязки теперь — номер связи.
 *
 * Оригинал регистрируется сразу, производные создаются следом; пока они не
 * готовы, интерфейс показывает состояние обработки. Доступ ко всем вариантам
 * проверяется через запись: прямой путь приватность не обходит.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { sql, transaction, type Tx } from "../lib/db.ts";
import { ApiError } from "../lib/errors.ts";
import { config } from "../lib/config.ts";
import { can, canSeeDrafts, require as requirePermission } from "../lib/auth.ts";
import { contributorFromCookie } from "./session.ts";
import { type AppEnv, decodeCursor, encodeCursor, log, pageSize } from "../lib/http.ts";
import {
  assetClassFor,
  canDerive,
  checkUpload,
  makeDerivative,
  openStored,
  storeOriginal,
  type Variant,
} from "../lib/media.ts";
import {
  createLink,
  createRecord,
  type ParamAnswer,
  publishLinkWorking,
  saveLinkRevision,
  saveRevision,
  setAnswers,
  setPublished,
} from "../lib/records.ts";

export const media = new Hono<AppEnv>();

/** Пустое поле формы — это отсутствие сведений, а не пустая строка. */
function text(form: FormData, name: string): string | null {
  const value = form.get(name);
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function number(form: FormData, name: string): number | null {
  const value = text(form, name);
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Ключевые слова перечисляются через запятую; повторы и пустые отбрасываются. */
function keywords(form: FormData): string[] {
  const value = text(form, "keywords");
  return value ? [...new Set(value.split(",").map((k) => k.trim()).filter(Boolean))] : [];
}

/**
 * Поля медиатеки → параметры записи-изображения. Имена полей прежние:
 * клиент и сценарии наполнения работают без переделки.
 */
const FIELDS: [field: string, param: string, kind: "text" | "num" | "option"][] = [
  ["kind", "image_kind", "option"],
  ["author", "image_author", "text"],
  ["credit", "rights_holder", "text"],
  ["source_url", "image_source_url", "text"],
  ["original_caption", "source_caption", "text"],
  ["holder", "holder", "text"],
  ["inventory_no", "inventory_no", "text"],
  ["created_year", "created_year", "num"],
  ["license", "license", "text"],
  ["alt", "alt_text", "text"],
  ["description", "image_description", "text"],
];

/** Ответы из присланных полей; непереданное поле не трогается. */
function answersFrom(get: (field: string) => unknown): ParamAnswer[] {
  const out: ParamAnswer[] = [];
  for (const [field, code, kind] of FIELDS) {
    const raw = get(field);
    if (raw === undefined) continue;
    if (kind === "num") {
      const value = raw === null || raw === "" ? null : Number(raw);
      out.push({ code, num: Number.isFinite(value as number) ? value as number : null });
    } else if (kind === "option") out.push({ code, option: raw ? String(raw) : null });
    else out.push({ code, text: raw === null ? null : String(raw) });
  }
  return out;
}

async function writeTags(tx: Tx, entityId: number, words: string[]) {
  for (const word of words) {
    const existing = await tx<{ id: string }>`
      select id from app.tags where lower(btrim(title)) = lower(btrim(${word}))
    `;
    const tagId = existing.length > 0 ? existing[0].id : (await tx<{ id: string }>`
      insert into app.tags (title) values (${word}) returning id
    `)[0].id;
    await tx`insert into app.entity_tags (entity_id, tag_id) values (${entityId}, ${tagId})
             on conflict do nothing`;
  }
}

/**
 * Файл в виде, который знает медиатека: сведения — из выбранной редакции
 * записи, состав вариантов — из реестра файла.
 */
async function assetView(assetId: string, drafts = true) {
  const rows = await sql<Record<string, unknown>>`
    select a.id, a.asset_class, a.created_at, a.entity_id,
           app.image_json(a.entity_id, ${drafts}) as info,
           app.image_needs_attribution(a.entity_id) as needs_attribution,
           coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title) order by t.title)
                       from app.entity_tags et join app.tags t on t.id = et.tag_id
                      where et.entity_id = a.entity_id), '[]'::jsonb) as tags,
           (select jsonb_object_agg(f.variant, jsonb_build_object(
                     'status', f.status, 'width', f.width, 'height', f.height,
                     'size_bytes', f.size_bytes, 'mime_type', f.mime_type))
              from app.media_files f where f.asset_id = a.id and f.is_current) as files
      from app.media_assets a where a.id = ${assetId} and a.archived_at is null
  `;
  if (rows.length === 0) throw new ApiError("not_found", "Файл не найден");
  return flatten(rows[0]);
}

/** Сведения записи кладутся в ответ прежними полями файла. */
function flatten(row: Record<string, unknown>) {
  const info = (row.info ?? {}) as Record<string, unknown>;
  const { info: _drop, ...rest } = row;
  return {
    ...rest,
    entity_slug: info.slug ?? null,
    caption_ru: info.title ?? null,
    kind: info.kind ?? null,
    author: info.author ?? null,
    credit: info.credit ?? null,
    source_url: info.source_url ?? null,
    original_caption: info.original_caption ?? null,
    holder: info.holder ?? null,
    inventory_no: info.inventory_no ?? null,
    created_year: info.created_year ?? null,
    license_code: info.license_code ?? null,
    alt_text: info.alt_text ?? null,
    description: info.description ?? null,
    is_published: info.is_published ?? false,
    // Видимость файла — публикация его записи (Р-84).
    visibility: info.is_published ? "public" : "private",
  };
}

media.get("/", async (c: Context<AppEnv>) => {
  const principal = c.get("principal");
  const limit = pageSize(c.req.query("limit"));
  const after = decodeCursor(c.req.query("cursor"));
  const drafts = canSeeDrafts(principal);
  const search = c.req.query("q")?.trim() || null;
  const pattern = search ? `%${search}%` : null;
  // Ссылки — задача, а не запрет (Р-68): медиатека умеет показать отдельно те
  // файлы, у которых нечем подписать автора или источник.
  const onlyNeedy = c.req.query("needs") === "attribution";

  const rows = await sql<Record<string, unknown>>`
    select a.id, a.asset_class, a.created_at, a.entity_id,
           app.image_json(a.entity_id, ${drafts}) as info,
           app.image_needs_attribution(a.entity_id) as needs_attribution,
           (select jsonb_object_agg(f.variant, jsonb_build_object(
                     'status', f.status, 'width', f.width, 'height', f.height,
                     'size_bytes', f.size_bytes, 'mime_type', f.mime_type))
              from app.media_files f where f.asset_id = a.id and f.is_current) as files,
           coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title) order by t.title)
                       from app.entity_tags et join app.tags t on t.id = et.tag_id
                      where et.entity_id = a.entity_id), '[]'::jsonb) as tags,
           extract(epoch from a.created_at)::bigint as cursor_key
      from app.media_assets a
      join app.entities e on e.id = a.entity_id
     where a.archived_at is null and e.status <> 'archived'
       and (${drafts} or e.status = 'published')
       and (not ${onlyNeedy} or app.image_needs_attribution(a.entity_id))
       and (${after}::bigint is null or extract(epoch from a.created_at)::bigint > ${after})
       and (${pattern}::text is null
            or app.image_json(a.entity_id, ${drafts})::text ilike ${pattern}
            or exists (select 1 from app.entity_tags et join app.tags t on t.id = et.tag_id
                        where et.entity_id = a.entity_id and t.title ilike ${pattern}))
     order by a.created_at
     limit ${limit + 1}
  `;
  const hasMore = rows.length > limit;
  const items = (hasMore ? rows.slice(0, limit) : rows).map(flatten);
  // Сколько файлов ждут ссылок — чтобы задача была видна числом, а не
  // вспоминалась. Считаем только для тех, кто правит.
  const needy = drafts
    ? await sql<{ n: number }>`
        select count(*)::int as n from app.media_assets a
         where a.archived_at is null and app.image_needs_attribution(a.entity_id)`
    : [{ n: 0 }];
  return c.json({
    items,
    needs_attribution: needy[0].n,
    next_cursor: hasMore ? encodeCursor(Number(rows[limit - 1].cursor_key)) : null,
  });
});

/**
 * Загрузка оригинала. Вместе с файлом заводится его запись «Изображение»:
 * подпись — название, остальные поля формы — сведения. Новый файл — черновик,
 * как и любая новая запись. Сервер не скачивает произвольные адреса.
 */
media.post("/", async (c: Context<AppEnv>) => {
  const principal = requirePermission(c.get("principal"), "create_delete");
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    throw new ApiError("validation_failed", "Не передан файл в поле file");
  }

  const mimeType = file.type || "application/octet-stream";
  checkUpload(mimeType, file.size);

  const stored = await storeOriginal(file.stream(), mimeType, file.name);

  const created = await transaction(principal.contributorId, async (tx) => {
    const caption = text(form, "caption") ?? file.name;
    const record = await createRecord(tx, {
      type: "image", title: caption, slugBase: `izobrazhenie ${caption}`,
      contributorId: principal.contributorId,
    });
    const assets = await tx<{ id: string }>`
      insert into app.media_assets (asset_class, entity_id, created_by)
      values (${assetClassFor(mimeType)}, ${record.id}, ${principal.contributorId})
      returning id
    `;
    const assetId = assets[0].id;
    await tx`
      insert into app.media_files (asset_id, variant, storage_key, original_name, mime_type,
                                   size_bytes, width, height, sha256, status, generated_at)
      values (${assetId}, 'original', ${stored.storageKey}, ${file.name}, ${mimeType},
              ${stored.sizeBytes}, ${stored.width}, ${stored.height}, ${stored.sha256},
              'ready', now())
    `;
    await setAnswers(tx, record.id, answersFrom((field) =>
      field === "created_year" ? number(form, field) ?? undefined : text(form, field) ?? undefined));
    // Ключевые слова из формы становятся метками записи.
    await writeTags(tx, record.id, keywords(form));
    await saveRevision(tx, record.id, principal.contributorId, "Загрузка файла", "create");
    if (form.get("visibility") === "public") await setPublished(tx, record.id, true);
    return { assetId };
  });

  // Производные делаем сразу после регистрации: неудача не теряет оригинал.
  if (canDerive(mimeType)) {
    await generateDerivatives(created.assetId, stored.storageKey, c.get("requestId"));
  }

  const result = await assetView(created.assetId);
  c.header("location", `/api/v1/media/${created.assetId}`);
  return c.json(result, 201);
});

async function generateDerivatives(assetId: string, originalKey: string, requestId: string) {
  for (const variant of ["screen", "thumbnail"] as const) {
    try {
      const derived = await makeDerivative(originalKey, assetId, variant);
      await transaction(null, async (tx) => {
        await tx`
          update app.media_files set is_current = false
          where asset_id = ${assetId} and variant = ${variant} and is_current
        `;
        await tx`
          insert into app.media_files (asset_id, variant, source_file_id, storage_key, mime_type,
                                       size_bytes, width, height, sha256, status, recipe_version,
                                       transform_params, generated_at)
          values (${assetId}, ${variant},
                  (select id from app.media_files
                    where asset_id = ${assetId} and variant = 'original' and is_current),
                  ${derived.storageKey}, ${derived.mimeType}, ${derived.sizeBytes},
                  ${derived.width}, ${derived.height}, ${derived.sha256}, 'ready', 'v1',
                  ${JSON.stringify({ variant, recipe: config.media.recipeVersion })}::jsonb, now())
        `;
      });
    } catch (error) {
      log("warn", requestId, "производная не создана", {
        asset_id: assetId,
        variant,
        error: error instanceof Error ? error.message : String(error),
      });
      await transaction(null, (tx) =>
        tx`
          insert into app.media_files (asset_id, variant, source_file_id, status, error_code, is_current)
          values (${assetId}, ${variant},
                  (select id from app.media_files
                    where asset_id = ${assetId} and variant = 'original' and is_current),
                  'failed', 'derivative_failed', false)
        `);
    }
  }
}

media.get("/:id", async (c: Context<AppEnv>) => {
  const principal = c.get("principal");
  const drafts = canSeeDrafts(principal) || can(principal, "view");
  const asset = await assetView(c.req.param("id") ?? "", drafts);
  if (!asset.is_published && !drafts) throw new ApiError("not_found", "Файл не найден");
  return c.json(asset);
});

/** Выдача файла. Файл неопубликованной записи требует прав; оригинал — отдельное действие. */
media.get("/:id/file", async (c: Context<AppEnv>) => {
  const principal = c.get("principal");
  const assetId = c.req.param("id") ?? "";
  const variant = (c.req.query("variant") ?? "screen") as Variant;
  if (!["original", "screen", "thumbnail"].includes(variant)) {
    throw new ApiError("validation_failed", "Неизвестный вариант файла");
  }

  const rows = await sql<{ storage_key: string; mime_type: string; status: string; published: boolean }>`
    select f.storage_key, f.mime_type, f.status, e.status = 'published' as published
      from app.media_files f
      join app.media_assets a on a.id = f.asset_id
      join app.entities e on e.id = a.entity_id
     where f.asset_id = ${assetId} and f.variant = ${variant} and f.is_current
       and a.archived_at is null and e.status <> 'archived'
  `;
  const row = rows[0];
  if (!row) throw new ApiError("not_found", "Вариант файла не найден");
  if (row.status !== "ready") {
    throw new ApiError("not_found", "Файл ещё обрабатывается", { status: row.status });
  }

  // Тег <img> не может приложить токен, поэтому принимается и сессионная кука.
  // Файл виден всем, когда опубликована его запись (Р-84) — то же правило,
  // что у готовой страницы: она не ссылается на картинку, которой не отдают.
  const allowed = row.published || can(principal, "view") || canSeeDrafts(principal) ||
    (await contributorFromCookie(c.req.header("cookie"))) !== null;
  if (!allowed) throw new ApiError("not_found", "Файл не найден");

  const { file, size } = await openStored(row.storage_key);
  c.header("content-type", row.mime_type);
  c.header("content-length", String(size));
  c.header("cache-control", row.published ? "public, max-age=86400" : "private, no-store");
  // Изображение показываем как цитату — в учебном окружении страницы. В
  // картиночном поиске оно оказалось бы без автора, источника и контекста,
  // то есть перестало бы быть цитатой (Р-68).
  c.header("x-robots-tag", "noimageindex");
  return c.body(file.readable);
});

/**
 * Прикрепление изображения к записи — связь «иллюстрация» (Р-84). Новое
 * изображение встаёт в конец: порядок задаёт автор. Роль «cover» отмечает
 * связь главной. Обоснование — подпись изображения; поправить его можно как
 * у любой связи. Связь публикуется сразу: прикреплённое изображение и раньше
 * становилось видно вместе с карточкой.
 */
media.post("/attachments", async (c: Context<AppEnv>) => {
  const principal = requirePermission(c.get("principal"), "edit");
  const input = await c.req.json<{ entity_id: number; asset_id: string; role?: string }>();
  if (!Number.isInteger(input.entity_id) || !input.asset_id) {
    throw new ApiError("validation_failed", "Не указаны сущность и файл");
  }

  const result = await transaction(principal.contributorId, async (tx) => {
    const owner = await tx<{ id: number }>`select id from app.entities where id = ${input.entity_id}`;
    if (owner.length === 0) throw new ApiError("not_found", "Сущность не найдена");
    const images = await tx<{ entity_id: number; title: string }>`
      select a.entity_id, e.title_ru as title from app.media_assets a
        join app.entities e on e.id = a.entity_id where a.id = ${input.asset_id}
    `;
    if (images.length === 0) throw new ApiError("not_found", "Файл не найден");
    const imageId = Number(images[0].entity_id);

    const same = await tx`
      select l.id from app.links l join app.link_roles r on r.id = l.role_id
       where r.code = 'illustration' and l.status <> 'archived'
         and l.from_entity_id = ${input.entity_id} and l.to_entity_id = ${imageId}
    `;
    if (same.length > 0) throw new ApiError("duplicate", "Этот файл уже прикреплён");

    const next = await tx<{ n: number }>`
      select coalesce(max(l.sort_order), -1) + 1 as n
        from app.links l join app.link_roles r on r.id = l.role_id
       where r.code = 'illustration' and l.status <> 'archived' and l.from_entity_id = ${input.entity_id}
    `;
    const linkId = await createLink(tx, {
      from: input.entity_id, to: imageId, role: "illustration",
      justification: images[0].title || "Иллюстрация", contributorId: principal.contributorId,
      sortOrder: Number(next[0].n), isPrimary: input.role === "cover", publish: true,
    });
    return { attachment_id: linkId, link_id: linkId };
  });

  return c.json(result, 201);
});

/**
 * Порядок изображений у записи. Присылается весь список связей в нужном
 * порядке: так перестановка не зависит от того, что видел клиент раньше,
 * и не оставляет дыр в нумерации. Порядок — поле связи, поэтому меняется
 * редакция связи и сразу публикуется.
 */
media.put("/attachments/order", async (c: Context<AppEnv>) => {
  const principal = requirePermission(c.get("principal"), "edit");
  const input = await c.req.json<{ entity_id: number; order: number[] }>();
  if (!Number.isInteger(input.entity_id) || !Array.isArray(input.order)) {
    throw new ApiError("validation_failed", "Нужны объект и порядок привязок");
  }

  const result = await transaction(principal.contributorId, async (tx) => {
    const links = await tx<{ id: number; sort_order: number; status: string }>`
      select l.id, l.sort_order, l.status from app.links l join app.link_roles r on r.id = l.role_id
       where r.code = 'illustration' and l.status <> 'archived' and l.from_entity_id = ${input.entity_id}
    `;
    const known = new Map(links.map((row) => [Number(row.id), row]));
    const unknown = input.order.filter((id) => !known.has(Number(id)));
    if (unknown.length > 0) {
      throw new ApiError("validation_failed", "В порядке есть чужие привязки", { unknown });
    }

    for (const [index, linkId] of input.order.entries()) {
      const link = known.get(Number(linkId))!;
      if (Number(link.sort_order) === index) continue;
      await tx`update app.links set sort_order = ${index} where id = ${linkId}`;
      await saveLinkRevision(tx, Number(linkId), principal.contributorId, "Порядок изображений");
      if (link.status === "published") await publishLinkWorking(tx, Number(linkId));
    }
    return { entity_id: input.entity_id, ordered: input.order.length };
  });

  return c.json(result);
});

/** Открепление — архивирование связи: история и сам файл остаются. */
media.delete("/attachments/:id", async (c: Context<AppEnv>) => {
  const principal = requirePermission(c.get("principal"), "edit");
  const removed = await transaction(principal.contributorId, (tx) => tx`
    update app.links l set status = 'archived', published_revision_id = null
      from app.link_roles r
     where r.id = l.role_id and r.code = 'illustration'
       and l.id = ${Number(c.req.param("id") ?? "")} and l.status <> 'archived'
    returning l.id
  `);
  if (removed.length === 0) throw new ApiError("not_found", "Привязка не найдена");
  return c.body(null, 204);
});

/**
 * Правка сведений об изображении: подпись — название записи, прочее —
 * параметры. Файл не меняется. Опубликованное изображение остаётся
 * опубликованным: медиатека правит сведения сразу, как и раньше.
 */
media.patch("/:id", async (c: Context<AppEnv>) => {
  const principal = requirePermission(c.get("principal"), "edit");
  const assetId = c.req.param("id") ?? "";
  const input = await c.req.json<Record<string, unknown>>();

  await transaction(principal.contributorId, async (tx) => {
    const found = await tx<{ entity_id: number; status: string }>`
      select a.entity_id, e.status from app.media_assets a join app.entities e on e.id = a.entity_id
       where a.id = ${assetId} and a.archived_at is null
    `;
    if (found.length === 0) throw new ApiError("not_found", "Файл не найден");
    const entityId = Number(found[0].entity_id);

    const caption = typeof input.caption === "string" ? input.caption.trim() : null;
    if (caption) await tx`update app.entities set title_ru = ${caption} where id = ${entityId}`;
    // Пустое значение в правке — «не менять»: так было и до перехода.
    await setAnswers(tx, entityId, answersFrom((field) => {
      const value = input[field];
      return value === null || value === undefined || value === "" ? undefined : value;
    }));
    await saveRevision(tx, entityId, principal.contributorId, "Правка сведений о файле");

    const wanted = input.visibility === "public" ? true : input.visibility === "private" ? false : null;
    const publish = wanted ?? found[0].status === "published";
    await setPublished(tx, entityId, publish);
  });

  return c.json(await assetView(assetId));
});

/** Повтор обработки после ошибки. */
media.post("/:id/derivatives", async (c: Context<AppEnv>) => {
  requirePermission(c.get("principal"), "edit");
  const assetId = c.req.param("id") ?? "";
  const rows = await sql<{ storage_key: string }>`
    select storage_key from app.media_files
    where asset_id = ${assetId} and variant = 'original' and is_current
  `;
  if (rows.length === 0) throw new ApiError("not_found", "Оригинал не найден");
  await generateDerivatives(assetId, rows[0].storage_key, c.get("requestId"));
  return c.json(await assetView(assetId));
});
