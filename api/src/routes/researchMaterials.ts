/**
 * Материалы в работе: папка исследований у записи и опись её файлов.
 *
 * Решение пользователя 2026-10-15: материалы по объектам собираются раньше,
 * чем готовы к публикации. Файлы остаются в research_notes на компьютере
 * редакции; сайт хранит ссылку на папку и опись — что собрано, сколько, что
 * уже ушло в медиатеку. Всё это видят только редакторы: таблицы вне версий
 * записи и не публикуются (0051).
 *
 * Опись присылает скрипт tools/sync_materials.py.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { sql, transaction } from "../lib/db.ts";
import { ApiError } from "../lib/errors.ts";
import { require as requirePermission } from "../lib/auth.ts";
import type { AppEnv } from "../lib/http.ts";

export const researchMaterials = new Hono<AppEnv>();

/** Путь папки внутри research_notes: относительный, без «..» и обратных слешей. */
function cleanPath(raw: unknown): string {
  const path = String(raw ?? "").trim().replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  if (!path || path.split("/").includes("..")) {
    throw new ApiError("validation_failed", "Путь папки — относительный путь внутри research_notes");
  }
  return path;
}

interface FileInput {
  path: string;
  size: number;
  modified?: string | null;
  sha256?: string | null;
}

/**
 * Опись материалов записи: папка, файлы и какие из них уже в медиатеке
 * (совпадение контрольной суммы с оригиналом файла медиатеки).
 */
export async function materialsOf(entityId: number) {
  const folder = await sql<{ path: string; synced_at: string | null }>`
    select path, synced_at from app.entity_materials where entity_id = ${entityId}
  `;
  if (folder.length === 0) return null;
  const files = await sql<{
    path: string; size_bytes: number; modified_at: string | null; sha256: string | null;
    media_entity_id: number | null; media_slug: string | null; media_published: boolean | null;
  }>`
    select f.rel_path as path, f.size_bytes, f.modified_at, f.sha256,
           m.entity_id as media_entity_id, m.slug as media_slug, m.published as media_published
      from app.material_files f
      left join lateral (
          select a.entity_id, e.slug, e.status = 'published' as published
            from app.media_files mf
            join app.media_assets a on a.id = mf.asset_id and a.archived_at is null
            join app.entities e on e.id = a.entity_id
           where f.sha256 is not null and mf.sha256 = f.sha256 and mf.variant = 'original'
           order by (e.status = 'published') desc limit 1) m on true
     where f.entity_id = ${entityId}
     order by f.rel_path
  `;
  return { path: folder[0].path, synced_at: folder[0].synced_at, files };
}

/** Папки всех записей — для скрипта синхронизации. */
researchMaterials.get("/research-materials", async (c: Context<AppEnv>) => {
  requirePermission(c.get("principal"), "edit");
  const rows = await sql`
    select m.entity_id, e.slug, e.title_ru, m.path, m.synced_at,
           (app.entity_type_path(e.type_id) -> 0 ->> 'code') as root,
           (select count(*) from app.material_files f where f.entity_id = m.entity_id)::int as files
      from app.entity_materials m join app.entities e on e.id = m.entity_id
     order by m.path
  `;
  return c.json({ items: rows });
});

/** Опись одной записи. */
researchMaterials.get("/entities/:id/research-materials", async (c: Context<AppEnv>) => {
  requirePermission(c.get("principal"), "edit");
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) throw new ApiError("not_found", "Запись не найдена");
  return c.json(await materialsOf(id) ?? { path: null, synced_at: null, files: [] });
});

/** Привязать папку к записи (или сменить путь). Пустой путь — отвязать. */
researchMaterials.put("/entities/:id/research-materials", async (c: Context<AppEnv>) => {
  const principal = requirePermission(c.get("principal"), "edit");
  const id = Number(c.req.param("id"));
  const input = await c.req.json<{ path?: string | null }>().catch(() => ({} as { path?: string | null }));
  const exists = await sql`select 1 from app.entities where id = ${id}`;
  if (exists.length === 0) throw new ApiError("not_found", "Запись не найдена");
  if (!input.path) {
    await transaction(principal.contributorId, (tx) => tx`delete from app.entity_materials where entity_id = ${id}`);
    return c.json({ entity_id: id, path: null });
  }
  const path = cleanPath(input.path);
  await transaction(principal.contributorId, (tx) => tx`
    insert into app.entity_materials (entity_id, path) values (${id}, ${path})
    on conflict (entity_id) do update set path = excluded.path, updated_at = now()
  `);
  return c.json({ entity_id: id, path });
});

/**
 * Опись папки целиком: прежние строки, которых нет в присланной описи,
 * удаляются (файл убрали из папки).
 */
researchMaterials.put("/entities/:id/research-materials/files", async (c: Context<AppEnv>) => {
  const principal = requirePermission(c.get("principal"), "edit");
  const id = Number(c.req.param("id"));
  const input = await c.req.json<{ files?: FileInput[] }>().catch(() => ({} as { files?: FileInput[] }));
  if (!Array.isArray(input.files)) throw new ApiError("validation_failed", "Нужен список files");
  const folder = await sql`select 1 from app.entity_materials where entity_id = ${id}`;
  if (folder.length === 0) throw new ApiError("validation_failed", "У записи нет папки материалов");
  const files = input.files.map((f) => ({
    path: cleanPath(f.path), size: Math.max(0, Math.trunc(Number(f.size) || 0)),
    modified: f.modified ?? null, sha256: f.sha256 && /^[0-9a-f]{64}$/i.test(f.sha256) ? f.sha256.toLowerCase() : null,
  }));
  await transaction(principal.contributorId, async (tx) => {
    const payload = JSON.stringify(files);
    await tx`
      delete from app.material_files
       where entity_id = ${id}
         and rel_path not in (select x->>'path' from jsonb_array_elements(${payload}::jsonb) x)
    `;
    await tx`
      insert into app.material_files (entity_id, rel_path, size_bytes, modified_at, sha256, seen_at)
      select ${id}, x->>'path', (x->>'size')::bigint, (x->>'modified')::timestamptz, x->>'sha256', now()
        from jsonb_array_elements(${payload}::jsonb) x
      on conflict (entity_id, rel_path) do update
        set size_bytes = excluded.size_bytes, modified_at = excluded.modified_at,
            sha256 = excluded.sha256, seen_at = now()
    `;
    await tx`update app.entity_materials set synced_at = now() where entity_id = ${id}`;
  });
  return c.json({ entity_id: id, files: files.length });
});
