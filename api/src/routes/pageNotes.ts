/**
 * Пометки на страницах сайта (Р-95): замечания редакторов поверх живой
 * страницы — ветки комментариев и рисунки. Читают и пишут только участники
 * с правом `edit` (и su); гостю маршрут отвечает 401, а готовые страницы
 * сервера таблицу не читают вовсе — читателю сайт не тяжелеет.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { sql, transaction } from "../lib/db.ts";
import { ApiError } from "../lib/errors.ts";
import { can, require as requirePermission } from "../lib/auth.ts";
import type { AppEnv } from "../lib/http.ts";
import { resolveEntity } from "../lib/publicCard.ts";

export const pageNotes = new Hono<AppEnv>();

const KINDS = new Set(["comment", "sticky", "text", "pen", "rect", "arrow", "reply"]);
const COLORS = new Set(["red", "ink", "orange", "blue", "green"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function noteId(c: Context<AppEnv>): string {
  const id = c.req.param("id") ?? "";
  if (!UUID.test(id)) throw new ApiError("not_found", "Пометка не найдена");
  return id;
}

interface NoteRow {
  id: string;
  page_path: string;
  entity_id: number | null;
  parent_id: string | null;
  kind: string;
  anchor: unknown;
  geometry: unknown;
  body: string;
  color: string;
  viewport_width: number | null;
  status: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  author: string | null;
  resolved_at: string | null;
}

/** Адрес страницы без домена, параметров и хвостового «/». */
function cleanPath(raw: unknown): string {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.length > 500) {
    throw new ApiError("validation_failed", "Адрес страницы должен начинаться с «/»");
  }
  const path = raw.split(/[?#]/)[0];
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

/** Небольшой JSON без вложенных глубин: привязка и форма пометки. */
function smallJson(value: unknown, name: string): unknown {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object") throw new ApiError("validation_failed", `${name}: ожидается объект`);
  if (JSON.stringify(value).length > 60_000) throw new ApiError("payload_too_large", `${name}: слишком велико`);
  return value;
}

async function entityForPath(path: string): Promise<number | null> {
  const match = /^\/entities\/([^/]+)$/.exec(path);
  if (!match || match[1] === "new") return null;
  const found = await resolveEntity(decodeURIComponent(match[1]), true);
  return found?.id ?? null;
}

/** Пометки страницы с ветками ответов. `status=all` — вместе с решёнными. */
pageNotes.get("/", async (c: Context<AppEnv>) => {
  requirePermission(c.get("principal"), "edit");
  const path = cleanPath(c.req.query("path"));
  const all = c.req.query("status") === "all";
  const notes = await sql<NoteRow>`
    select n.id, n.page_path, n.entity_id, n.parent_id, n.kind, n.anchor, n.geometry,
           n.body, n.color, n.viewport_width, n.status, n.created_at, n.updated_at,
           n.created_by, c.display_name as author, n.resolved_at
      from app.page_notes n
      left join app.contributors c on c.id = n.created_by
     where n.page_path = ${path} and n.parent_id is null and (${all} or n.status = 'open')
     order by n.created_at`;
  const ids = notes.map((n) => n.id);
  const replies = ids.length === 0 ? [] : await sql<NoteRow>`
    select n.id, n.page_path, n.entity_id, n.parent_id, n.kind, n.anchor, n.geometry,
           n.body, n.color, n.viewport_width, n.status, n.created_at, n.updated_at,
           n.created_by, c.display_name as author, n.resolved_at
      from app.page_notes n
      left join app.contributors c on c.id = n.created_by
     where n.parent_id = any(${ids}::uuid[])
     order by n.created_at`;
  return c.json({
    items: notes.map((note) => ({ ...note, replies: replies.filter((r) => r.parent_id === note.id) })),
  });
});

/** Открытые замечания по всему сайту: что ещё не сделано и где. */
pageNotes.get("/open", async (c: Context<AppEnv>) => {
  requirePermission(c.get("principal"), "edit");
  const rows = await sql<{ page_path: string; open: number; last_at: string }>`
    select page_path, count(*)::int as open, max(updated_at) as last_at
      from app.page_notes
     where parent_id is null and status = 'open'
     group by page_path
     order by max(updated_at) desc`;
  return c.json({ items: rows });
});

pageNotes.post("/", async (c: Context<AppEnv>) => {
  const principal = requirePermission(c.get("principal"), "edit");
  const input = await c.req.json<Record<string, unknown>>();
  const kind = String(input.kind ?? "");
  if (!KINDS.has(kind)) throw new ApiError("validation_failed", "Неизвестный вид пометки");
  const color = COLORS.has(String(input.color)) ? String(input.color) : "red";
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (body.length > 4000) throw new ApiError("payload_too_large", "Текст пометки длиннее 4000 знаков");
  if ((kind === "comment" || kind === "reply" || kind === "sticky") && !body) {
    throw new ApiError("validation_failed", "У замечания должен быть текст");
  }
  const width = Number(input.viewport_width);
  const viewport = Number.isFinite(width) && width >= 200 && width <= 10000 ? Math.round(width) : null;

  let path: string;
  let parent: string | null = null;
  if (kind === "reply") {
    const [root] = await sql<{ id: string; page_path: string }>`
      select id, page_path from app.page_notes where id = ${UUID.test(String(input.parent_id ?? "")) ? String(input.parent_id) : null}::uuid and parent_id is null`;
    if (!root) throw new ApiError("not_found", "Ветка замечания не найдена");
    parent = root.id;
    path = root.page_path;
  } else {
    path = cleanPath(input.page_path);
  }
  const entityId = await entityForPath(path);
  const anchor = JSON.stringify(smallJson(input.anchor, "Привязка"));
  const geometry = JSON.stringify(smallJson(input.geometry, "Форма"));

  const [row] = await transaction(principal.contributorId, (tx) => tx<{ id: string }>`
    insert into app.page_notes (page_path, entity_id, parent_id, kind, anchor, geometry, body, color,
                                viewport_width, created_by, updated_by)
    values (${path}, ${entityId}, ${parent}, ${kind}, ${anchor}::jsonb, ${geometry}::jsonb, ${body},
            ${color}, ${viewport}, ${principal.contributorId}, ${principal.contributorId})
    returning id`);
  return c.json({ id: row.id }, 201);
});

/**
 * Правка: текст и форму меняет автор (или su), «решено»/«открыть снова» —
 * любой редактор: решает тот, кто сделал правку.
 */
pageNotes.patch("/:id", async (c: Context<AppEnv>) => {
  const principal = requirePermission(c.get("principal"), "edit");
  const id = noteId(c);
  const input = await c.req.json<Record<string, unknown>>();
  const [note] = await sql<{ id: string; created_by: string | null }>`
    select id, created_by from app.page_notes where id = ${id}::uuid`;
  if (!note) throw new ApiError("not_found", "Пометка не найдена");
  const own = note.created_by === principal.contributorId || can(principal, "su");
  const content = input.body !== undefined || input.geometry !== undefined ||
    input.anchor !== undefined || input.color !== undefined;
  if (content && !own) throw new ApiError("permission_denied", "Менять пометку может её автор");

  const body = typeof input.body === "string" ? input.body.trim() : null;
  if (body !== null && body.length > 4000) throw new ApiError("payload_too_large", "Текст длиннее 4000 знаков");
  const status = input.status === "open" || input.status === "resolved" ? input.status : null;
  const color = input.color !== undefined && COLORS.has(String(input.color)) ? String(input.color) : null;
  const geometry = input.geometry !== undefined ? JSON.stringify(smallJson(input.geometry, "Форма")) : null;
  const anchor = input.anchor !== undefined ? JSON.stringify(smallJson(input.anchor, "Привязка")) : null;

  await transaction(principal.contributorId, (tx) => tx`
    update app.page_notes set
      body = coalesce(${body}, body),
      color = coalesce(${color}, color),
      geometry = coalesce(${geometry}::jsonb, geometry),
      anchor = coalesce(${anchor}::jsonb, anchor),
      status = coalesce(${status}, status),
      resolved_at = case when ${status}::text = 'resolved' then now()
                         when ${status}::text = 'open' then null else resolved_at end,
      resolved_by = case when ${status}::text = 'resolved' then ${principal.contributorId}::uuid
                         when ${status}::text = 'open' then null else resolved_by end
    where id = ${id}::uuid`);
  return c.json({ ok: true });
});

/** Удалить может автор или su; с веткой уходят и ответы. */
pageNotes.delete("/:id", async (c: Context<AppEnv>) => {
  const principal = requirePermission(c.get("principal"), "edit");
  const id = noteId(c);
  const [note] = await sql<{ created_by: string | null }>`
    select created_by from app.page_notes where id = ${id}::uuid`;
  if (!note) throw new ApiError("not_found", "Пометка не найдена");
  if (note.created_by !== principal.contributorId && !can(principal, "su")) {
    throw new ApiError("permission_denied", "Удалить пометку может её автор");
  }
  await transaction(principal.contributorId, (tx) => tx`delete from app.page_notes where id = ${id}::uuid`);
  return c.body(null, 204);
});
