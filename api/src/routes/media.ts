/**
 * Медиатека: загрузка оригинала, состояние производных, выдача файлов.
 *
 * Оригинал регистрируется сразу, производные создаются следом; пока они не
 * готовы, интерфейс показывает состояние обработки, а не подсовывает
 * большой оригинал. Доступ ко всем вариантам проверяется через запись
 * реестра: прямой путь приватность не обходит.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { sql, transaction } from "../lib/db.ts";
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

interface AssetRow {
  id: string;
  visibility: "public" | "private";
  is_published: boolean;
  caption_ru: string | null;
  credit: string | null;
}

media.get("/", async (c: Context<AppEnv>) => {
  const principal = c.get("principal");
  const limit = pageSize(c.req.query("limit"));
  const after = decodeCursor(c.req.query("cursor"));
  const drafts = canSeeDrafts(principal);
  const search = c.req.query("q")?.trim() || null;
  const pattern = search ? `%${search}%` : null;

  const rows = await sql<Record<string, unknown>>`
    select a.id, a.asset_class, a.caption_ru, a.credit, a.visibility, a.is_published,
           a.created_at,
           (select f.status from app.media_files f
             where f.asset_id = a.id and f.variant = 'original' and f.is_current) as original_status,
           (select f.status from app.media_files f
             where f.asset_id = a.id and f.variant = 'screen' and f.is_current) as screen_status,
           (select f.status from app.media_files f
             where f.asset_id = a.id and f.variant = 'thumbnail' and f.is_current) as thumbnail_status,
           (select k.code from app.media_kinds k where k.id = a.kind_id) as kind,
           a.author, a.holder, a.keywords, a.created_year, a.description,
           extract(epoch from a.created_at)::bigint as cursor_key
    from app.media_assets a
    where a.archived_at is null
      and (${drafts} or a.is_published)
      and (${after}::bigint is null or extract(epoch from a.created_at)::bigint > ${after})
      and (${pattern}::text is null
           or a.caption_ru ilike ${pattern} or a.description ilike ${pattern}
           or a.author ilike ${pattern} or a.holder ilike ${pattern}
           or exists (select 1 from unnest(a.keywords) k where k ilike ${pattern}))
    order by a.created_at
    limit ${limit + 1}
  `;
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return c.json({
    items,
    next_cursor: hasMore ? encodeCursor(Number(items[items.length - 1].cursor_key)) : null,
  });
});

/** Загрузка оригинала. Файл передаёт клиент; сервер не скачивает произвольные адреса. */
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
    const assets = await tx<{ id: string }>`
      insert into app.media_assets (asset_class, kind_id, caption_ru, alt_text, description,
                                    author, credit, source_url, license_code, created_year,
                                    created_note, holder, inventory_no, original_caption,
                                    keywords, visibility, created_by)
      values (${assetClassFor(mimeType)},
              (select id from app.media_kinds where code = ${text(form, "kind")}),
              ${text(form, "caption")}, ${text(form, "alt")}, ${text(form, "description")},
              ${text(form, "author")}, ${text(form, "credit")}, ${text(form, "source_url")},
              ${text(form, "license")}, ${number(form, "created_year")},
              ${text(form, "created_note")}, ${text(form, "holder")},
              ${text(form, "inventory_no")}, ${text(form, "original_caption")},
              ${keywords(form)},
              ${String(form.get("visibility") ?? "private") === "public" ? "public" : "private"},
              ${principal.contributorId})
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

    const materials = await tx<{ id: string }>`
      insert into app.materials (kind, asset_id, created_by)
      values ('asset', ${assetId}, ${principal.contributorId}) returning id
    `;
    await tx`
      insert into app.material_credits (material_id, contributor_id, credit_role)
      values (${materials[0].id}, ${principal.contributorId}, 'author')
    `;
    await tx`
      insert into app.revisions (material_id, edited_by, operation, summary, snapshot)
      values (${materials[0].id}, ${principal.contributorId}, 'create', 'Загрузка файла',
              ${JSON.stringify({ storage_key: stored.storageKey, sha256: stored.sha256, mime_type: mimeType })}::jsonb)
    `;
    return { assetId, materialId: materials[0].id };
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

async function assetView(assetId: string) {
  const rows = await sql<Record<string, unknown>>`
    select a.*,
           (select jsonb_object_agg(f.variant, jsonb_build_object(
                     'status', f.status, 'width', f.width, 'height', f.height,
                     'size_bytes', f.size_bytes, 'mime_type', f.mime_type))
            from app.media_files f where f.asset_id = a.id and f.is_current) as files
    from app.media_assets a where a.id = ${assetId}
  `;
  if (rows.length === 0) throw new ApiError("not_found", "Файл не найден");
  return rows[0];
}

media.get("/:id", async (c: Context<AppEnv>) => {
  const principal = c.get("principal");
  const asset = await assetView(c.req.param("id")) as unknown as AssetRow;
  if (!(asset.is_published && asset.visibility === "public") && !can(principal, "view") &&
      !canSeeDrafts(principal)) {
    throw new ApiError("not_found", "Файл не найден");
  }
  return c.json(asset);
});

/** Выдача файла. Приватный файл требует прав; оригинал — отдельное действие. */
media.get("/:id/file", async (c: Context<AppEnv>) => {
  const principal = c.get("principal");
  const assetId = c.req.param("id");
  const variant = (c.req.query("variant") ?? "screen") as Variant;
  if (!["original", "screen", "thumbnail"].includes(variant)) {
    throw new ApiError("validation_failed", "Неизвестный вариант файла");
  }

  const rows = await sql<{
    storage_key: string;
    mime_type: string;
    status: string;
    visibility: "public" | "private";
    is_published: boolean;
  }>`
    select f.storage_key, f.mime_type, f.status, a.visibility, a.is_published
    from app.media_files f
    join app.media_assets a on a.id = f.asset_id
    where f.asset_id = ${assetId} and f.variant = ${variant} and f.is_current
      and a.archived_at is null
  `;
  const row = rows[0];
  if (!row) throw new ApiError("not_found", "Вариант файла не найден");
  if (row.status !== "ready") {
    throw new ApiError("not_found", "Файл ещё обрабатывается", { status: row.status });
  }

  // Тег <img> не может приложить токен, поэтому принимается и сессионная кука.
  // Файл виден публично ровно тогда, когда опубликован его материал:
  // отдельной ручки доступа у файла нет (решение пользователя 2026-09-23).
  const publiclyVisible = row.is_published;
  const allowed = publiclyVisible || can(principal, "view") || canSeeDrafts(principal) ||
    (await contributorFromCookie(c.req.header("cookie"))) !== null;
  if (!allowed) {
    throw new ApiError("not_found", "Файл не найден");
  }

  const { file, size } = await openStored(row.storage_key);
  c.header("content-type", row.mime_type);
  c.header("content-length", String(size));
  c.header("cache-control", publiclyVisible ? "public, max-age=86400" : "private, no-store");
  return c.body(file.readable);
});

/** Прикрепление существующего файла к сущности с ролью: обложка, галерея. */
media.post("/attachments", async (c: Context<AppEnv>) => {
  const principal = requirePermission(c.get("principal"), "edit");
  const input = await c.req.json<{ entity_id: number; asset_id: string; role?: string }>();
  if (!Number.isInteger(input.entity_id) || !input.asset_id) {
    throw new ApiError("validation_failed", "Не указаны сущность и файл");
  }

  const result = await transaction(principal.contributorId, async (tx) => {
    const targets = await tx<{ id: number }>`
      select id from app.targets where entity_id = ${input.entity_id}
    `;
    if (targets.length === 0) throw new ApiError("not_found", "Сущность не найдена");

    const attached = await tx<{ id: number }>`
      insert into app.attachments (target_id, role_id, asset_id)
      values (${targets[0].id},
              (select id from app.attachment_roles where code = ${input.role ?? "gallery"}),
              ${input.asset_id})
      on conflict do nothing
      returning id
    `;
    if (attached.length === 0) {
      throw new ApiError("duplicate", "Этот файл уже прикреплён с такой ролью");
    }
    return { attachment_id: Number(attached[0].id) };
  });

  return c.json(result, 201);
});

media.delete("/attachments/:id", async (c: Context<AppEnv>) => {
  requirePermission(c.get("principal"), "edit");
  const removed = await sql`
    delete from app.attachments
     where id = ${Number(c.req.param("id"))} and asset_id is not null
    returning id
  `;
  if (removed.length === 0) throw new ApiError("not_found", "Привязка не найдена");
  return c.body(null, 204);
});

/** Правка сведений об изображении. Файл при этом не меняется. */
media.patch("/:id", async (c: Context<AppEnv>) => {
  const principal = requirePermission(c.get("principal"), "edit");
  const assetId = c.req.param("id");
  const input = await c.req.json<Record<string, unknown>>();
  const value = (name: string) => (input[name] ?? null) as string | null;

  await transaction(principal.contributorId, async (tx) => {
    const updated = await tx`
      update app.media_assets set
        kind_id = coalesce(
          (select id from app.media_kinds where code = ${value("kind")}), kind_id),
        caption_ru       = coalesce(${value("caption")}, caption_ru),
        alt_text         = coalesce(${value("alt")}, alt_text),
        description      = coalesce(${value("description")}, description),
        author           = coalesce(${value("author")}, author),
        credit           = coalesce(${value("credit")}, credit),
        source_url       = coalesce(${value("source_url")}, source_url),
        license_code     = coalesce(${value("license")}, license_code),
        created_year     = coalesce(${(input.created_year ?? null) as number}, created_year),
        created_note     = coalesce(${value("created_note")}, created_note),
        holder           = coalesce(${value("holder")}, holder),
        inventory_no     = coalesce(${value("inventory_no")}, inventory_no),
        original_caption = coalesce(${value("original_caption")}, original_caption),
        keywords         = coalesce(${(input.keywords ?? null) as string[]}, keywords),
        visibility       = coalesce(${value("visibility")}, visibility),
        updated_at       = now()
      where id = ${assetId} and archived_at is null
      returning id
    `;
    if (updated.length === 0) throw new ApiError("not_found", "Файл не найден");

    const materials = await tx<{ id: string }>`
      select id from app.materials where asset_id = ${assetId}
    `;
    if (materials.length > 0) {
      await tx`
        insert into app.revisions (material_id, edited_by, operation, summary, snapshot)
        values (${materials[0].id}, ${principal.contributorId}, 'edit',
                'Правка сведений о файле', ${JSON.stringify(input)}::jsonb)
      `;
    }
  });

  return c.json(await assetView(assetId));
});

/** Повтор обработки после ошибки. */
media.post("/:id/derivatives", async (c: Context<AppEnv>) => {
  requirePermission(c.get("principal"), "edit");
  const assetId = c.req.param("id");
  const rows = await sql<{ storage_key: string }>`
    select storage_key from app.media_files
    where asset_id = ${assetId} and variant = 'original' and is_current
  `;
  if (rows.length === 0) throw new ApiError("not_found", "Оригинал не найден");
  await generateDerivatives(assetId, rows[0].storage_key, c.get("requestId"));
  return c.json(await assetView(assetId));
});
