/**
 * Материалы в работе: папка исследований у записи и опись её файлов.
 *
 * Решение пользователя 2026-10-15: материалы по объектам собираются раньше,
 * чем готовы к публикации. Файлы складываются в Dropbox, в папку 2VHUTEMAS
 * (ЧТО/ПРОЕКТЫ, КТО/ЛЮДИ); сайт хранит ссылку на папку и опись — что собрано, сколько, что
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
import { createFolders, dropboxPath, dropboxReady, listAll, moveFolders } from "../lib/dropbox.ts";

export const researchMaterials = new Hono<AppEnv>();

/** Путь папки внутри 2VHUTEMAS: относительный, без «..» и обратных слешей. */
function cleanPath(raw: unknown): string {
  const path = String(raw ?? "").trim().replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  if (!path || path.split("/").includes("..")) {
    throw new ApiError("validation_failed", "Путь папки — относительный путь внутри 2VHUTEMAS");
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
    select m.entity_id, e.slug, e.title_ru, e.title_en, m.path, m.synced_at,
           (app.entity_type_path(e.type_id) -> 0 ->> 'code') as root,
           ty.code as type, ty.title_ru as type_title,
           (select count(*) from app.material_files f where f.entity_id = m.entity_id)::int as files
      from app.entity_materials m join app.entities e on e.id = m.entity_id
      join app.entity_types ty on ty.id = e.type_id
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

/**
 * Разделы Dropbox по ветвям записей и префиксы папок по типам (0052).
 * Решение пользователя 2026-10-15: ЧТО/ПРОЕКТЫ и КТО/ЛЮДИ, тип — префиксом
 * имени папки: «арх_объекты_Национальный театр Тайчжуна».
 */
const SECTIONS: Record<string, string> = { what: "ЧТО/ПРОЕКТЫ", who: "КТО/ЛЮДИ" };
const PREFIXES: Record<string, string> = {
  architecture_object: "арх_объекты",
  urban_concept: "градостроительство",
  performance: "постановки",
  book: "книги",
  article: "статьи",
  web_page: "веб_страницы",
  theory_concept: "теории",
  video: "видео",
  what: "что",
  person: "люди",
  company: "компании",
};

const cleanName = (t: string) =>
  t.replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "");

/**
 * Имя папки, допустимое в Dropbox и Windows: «<тип>_<название> (<English>)».
 * Английское название — в скобках (указание пользователя 2026-10-15), если есть.
 */
function folderName(prefix: string, title: string, titleEn: string | null = null): string {
  const en = cleanName(titleEn ?? "");
  const base = `${prefix}_${cleanName(title) || "без названия"}`;
  return (en && norm(en) !== norm(cleanName(title)) ? `${base} (${en})` : base).slice(0, 200);
}

const norm = (t: string) => t.replaceAll("ё", "е").replaceAll("Ё", "Е").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * «Обновить файловую структуру»: сопоставить папки, положенные вручную,
 * досоздать папки записям без папки, снять опись файлов.
 */
researchMaterials.post("/research-materials/refresh", async (c: Context<AppEnv>) => {
  const principal = requirePermission(c.get("principal"), "su");
  if (!dropboxReady()) {
    throw new ApiError("unavailable", "Dropbox не подключён: на сервере нет ключей приложения");
  }
  const entities = await sql<{
    id: number; title_ru: string; title_en: string | null; type: string; type_title: string; root: string; path: string | null;
  }>`
    select e.id, e.title_ru, e.title_en, ty.code as type, ty.title_ru as type_title,
           app.entity_type_path(e.type_id) -> 0 ->> 'code' as root, m.path
      from app.entities e
      join app.entity_types ty on ty.id = e.type_id
      left join app.entity_materials m on m.entity_id = e.id
     where e.status <> 'archived'
       and app.entity_type_path(e.type_id) -> 0 ->> 'code' in ('what', 'who')
     order by e.title_ru
  `;
  const prefixOf = (e: { type: string; type_title: string }) =>
    PREFIXES[e.type] ?? norm(e.type_title).replace(/[^a-zа-я0-9]+/g, "_").replace(/^_|_$/g, "");

  const listing = await listAll();
  const folders = new Map(listing.filter((x) => x.tag === "folder").map((x) => [x.path.toLowerCase(), x.path]));
  const taken = new Set(entities.filter((e) => e.path).map((e) => e.path!.toLowerCase()));

  // 1. Папки, положенные вручную: «<префикс>_<название> (<English>)», без
  //    английского или просто название. Папку, заведённую кнопкой по прежнему
  //    образцу (без английского), кнопка переименовывает.
  const linked: { id: number; path: string }[] = [];
  const renamed: { from: string; to: string }[] = [];
  const unmatched: string[] = [];
  for (const [root, section] of Object.entries(SECTIONS)) {
    const head = section.toLowerCase() + "/";
    for (const [key, path] of folders) {
      if (!key.startsWith(head) || key.slice(head.length).includes("/") || taken.has(key)) continue;
      const name = norm(path.slice(section.length + 1));
      // Одноимённым записям кнопка дописывает « (номер)» — по нему и узнаются.
      const byId = name.match(/ \((\d+)\)$/);
      const hits = byId
        ? entities.filter((e) => !e.path && e.id === Number(byId[1]))
        : entities.filter((e) => !e.path && e.root === root &&
          [e.title_ru, folderName(prefixOf(e), e.title_ru), folderName(prefixOf(e), e.title_ru, e.title_en)]
            .some((n) => norm(n) === name));
      if (hits.length === 1) {
        const e = hits[0];
        let target = path;
        const old = norm(folderName(prefixOf(e), e.title_ru));
        const wanted = `${section}/${folderName(prefixOf(e), e.title_ru, e.title_en)}`;
        if ((name === old || byId) && wanted !== path && !folders.has(wanted.toLowerCase()) && !taken.has(wanted.toLowerCase())) {
          renamed.push({ from: path, to: wanted });
          target = wanted;
        }
        e.path = target;
        taken.add(key);
        taken.add(target.toLowerCase());
        linked.push({ id: e.id, path: target });
      } else {
        unmatched.push(path);
      }
    }
  }

  // 2. Записям без папки — новая папка.
  const created: { id: number; path: string }[] = [];
  for (const e of entities) {
    if (e.path) continue;
    let path = `${SECTIONS[e.root]}/${folderName(prefixOf(e), e.title_ru, e.title_en)}`;
    if (taken.has(path.toLowerCase())) path = `${path} (${e.id})`;
    e.path = path;
    taken.add(path.toLowerCase());
    created.push({ id: e.id, path });
  }
  await moveFolders(renamed.map((r) => ({ from: dropboxPath(r.from), to: dropboxPath(r.to) })));
  await createFolders([...Object.values(SECTIONS), ...created.map((x) => x.path)]
    .filter((p) => !folders.has(p.toLowerCase())).map(dropboxPath));

  // 3. Таблица соответствия и опись файлов.
  // Опись снята до переименования — пути файлов переводятся на новые имена.
  const files = listing.filter((x) => x.tag === "file").map((f) => {
    const r = renamed.find((x) => f.path.toLowerCase().startsWith(x.from.toLowerCase() + "/"));
    return r ? { ...f, path: r.to + f.path.slice(r.from.length) } : f;
  });
  let counted = 0;
  await transaction(principal.contributorId, async (tx) => {
    for (const x of [...linked, ...created]) {
      await tx`insert into app.entity_materials (entity_id, path) values (${x.id}, ${x.path})
               on conflict (entity_id) do nothing`;
    }
    for (const e of entities) {
      const head = e.path!.toLowerCase() + "/";
      const own = files.filter((f) => f.path.toLowerCase().startsWith(head)).map((f) => ({
        path: f.path.slice(head.length), size: f.size, modified: f.modified, hash: f.contentHash,
      }));
      counted += own.length;
      const payload = JSON.stringify(own);
      await tx`delete from app.material_files where entity_id = ${e.id}
                 and rel_path not in (select x->>'path' from jsonb_array_elements(${payload}::jsonb) x)`;
      if (own.length) {
        await tx`
          insert into app.material_files (entity_id, rel_path, size_bytes, modified_at, content_hash, seen_at)
          select ${e.id}, x->>'path', (x->>'size')::bigint, (x->>'modified')::timestamptz, x->>'hash', now()
            from jsonb_array_elements(${payload}::jsonb) x
          on conflict (entity_id, rel_path) do update
            set size_bytes = excluded.size_bytes, modified_at = excluded.modified_at,
                content_hash = excluded.content_hash, seen_at = now(),
                -- sha256 присылает локальный скрипт; при другом размере он устарел.
                sha256 = case when app.material_files.size_bytes = excluded.size_bytes
                              then app.material_files.sha256 end
        `;
      }
      await tx`update app.entity_materials set synced_at = now() where entity_id = ${e.id}`;
    }
  });
  return c.json({ created: created.length, linked: linked.length, renamed: renamed.length, unmatched, entities: entities.length, files: counted });
});
