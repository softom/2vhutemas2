/**
 * Метки: общий справочник слов для всех записей.
 *
 * Слово выбирается из справочника либо пополняет его. Совпадение ищется
 * без учёта регистра и лишних пробелов, поэтому «Сиань» и «сиань» — одна
 * метка, а не две.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { sql, transaction, type Tx } from "../lib/db.ts";
import { ApiError } from "../lib/errors.ts";
import { require as requirePermission } from "../lib/auth.ts";
import { type AppEnv, pageSize } from "../lib/http.ts";

export const tags = new Hono<AppEnv>();

/** Подсказка по «#»: часто используемые слова, сужающиеся по набору. */
tags.get("/", async (c: Context<AppEnv>) => {
  const limit = pageSize(c.req.query("limit") ?? "20");
  const search = c.req.query("q")?.trim() ?? "";
  const pattern = search ? `%${search}%` : null;

  const rows = await sql<{ id: string; title: string; usages: number }>`
    select t.id, t.title,
           (select count(*) from app.entity_tags et where et.tag_id = t.id)
         + (select count(*) from app.media_tags mt where mt.tag_id = t.id) as usages
    from app.tags t
    where ${pattern}::text is null or t.title ilike ${pattern}
    order by usages desc, t.title
    limit ${limit}
  `;
  return c.json({ items: rows });
});

/**
 * Разбор списка слов: существующие берутся из справочника, новые заводятся.
 * Возвращает идентификаторы меток в том же составе.
 */
async function resolveTags(tx: Tx, titles: string[]): Promise<string[]> {
  const cleaned = [...new Set(
    titles.map((title) => title.replace(/^#/, "").trim()).filter((title) => title !== ""),
  )];
  if (cleaned.length === 0) return [];
  if (cleaned.some((title) => title.length > 64)) {
    throw new ApiError("validation_failed", "Метка длиннее 64 знаков");
  }

  const ids: string[] = [];
  for (const title of cleaned) {
    const existing = await tx<{ id: string }>`
      select id from app.tags where lower(btrim(title)) = lower(btrim(${title}))
    `;
    if (existing.length > 0) {
      ids.push(existing[0].id);
      continue;
    }
    const created = await tx<{ id: string }>`
      insert into app.tags (title) values (${title})
      on conflict do nothing
      returning id
    `;
    if (created.length > 0) {
      ids.push(created[0].id);
    } else {
      const again = await tx<{ id: string }>`
        select id from app.tags where lower(btrim(title)) = lower(btrim(${title}))
      `;
      if (again.length > 0) ids.push(again[0].id);
    }
  }
  return ids;
}

/** Метки записи задаются целиком: что прислали, то и остаётся. */
tags.put("/entities/:id", async (c: Context<AppEnv>) => {
  const principal = requirePermission(c.get("principal"), "edit");
  const entityId = Number(c.req.param("id"));
  if (!Number.isInteger(entityId)) throw new ApiError("validation_failed", "Неверный объект");
  const input = await c.req.json<{ tags: string[] }>();

  const result = await transaction(principal.contributorId, async (tx) => {
    const found = await tx<{ id: number }>`select id from app.entities where id = ${entityId}`;
    if (found.length === 0) throw new ApiError("not_found", "Объект не найден");

    const ids = await resolveTags(tx, input.tags ?? []);
    await tx`
      delete from app.entity_tags
       where entity_id = ${entityId} and not (tag_id = any(${ids}::uuid[]))
    `;
    for (const tagId of ids) {
      await tx`
        insert into app.entity_tags (entity_id, tag_id) values (${entityId}, ${tagId})
        on conflict do nothing
      `;
    }
    return tx<{ id: string; title: string }>`
      select t.id, t.title from app.entity_tags et
      join app.tags t on t.id = et.tag_id
      where et.entity_id = ${entityId} order by t.title
    `;
  });

  return c.json({ items: result });
});

tags.put("/media/:id", async (c: Context<AppEnv>) => {
  const principal = requirePermission(c.get("principal"), "edit");
  const assetId = c.req.param("id");
  const input = await c.req.json<{ tags: string[] }>();

  const result = await transaction(principal.contributorId, async (tx) => {
    const found = await tx<{ id: string }>`select id from app.media_assets where id = ${assetId}`;
    if (found.length === 0) throw new ApiError("not_found", "Файл не найден");

    const ids = await resolveTags(tx, input.tags ?? []);
    await tx`
      delete from app.media_tags
       where asset_id = ${assetId} and not (tag_id = any(${ids}::uuid[]))
    `;
    for (const tagId of ids) {
      await tx`
        insert into app.media_tags (asset_id, tag_id) values (${assetId}, ${tagId})
        on conflict do nothing
      `;
    }
    return tx<{ id: string; title: string }>`
      select t.id, t.title from app.media_tags mt
      join app.tags t on t.id = mt.tag_id
      where mt.asset_id = ${assetId} order by t.title
    `;
  });

  return c.json({ items: result });
});
