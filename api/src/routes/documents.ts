/**
 * Документы BlockNote: описание объекта и другие тексты.
 *
 * Оригинал — блочный JSON редактора. Текст для поиска производит сервер
 * (body_text и search_vector), клиент его не присылает. Неизвестные типы
 * блоков сохраняются как есть: молча терять авторскую композицию нельзя.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { sql, transaction, type Tx } from "../lib/db.ts";
import { ApiError } from "../lib/errors.ts";
import { canSeeDrafts, require as requirePermission } from "../lib/auth.ts";
import type { AppEnv } from "../lib/http.ts";
import { config } from "../lib/config.ts";

export const documents = new Hono<AppEnv>();

interface Block {
  id?: string;
  type?: string;
  content?: unknown;
  children?: Block[];
  props?: Record<string, unknown>;
}

/** Текст блоков: заголовки, абзацы, подписи и альтернативный текст изображений. */
export function extractText(blocks: unknown): string {
  const parts: string[] = [];
  const walkInline = (content: unknown) => {
    if (typeof content === "string") {
      parts.push(content);
      return;
    }
    if (Array.isArray(content)) {
      for (const item of content) walkInline(item);
      return;
    }
    if (content && typeof content === "object") {
      const node = content as Record<string, unknown>;
      if (typeof node.text === "string") parts.push(node.text);
      if (node.content) walkInline(node.content);
    }
  };

  const walk = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const block of list as Block[]) {
      walkInline(block.content);
      const props = block.props ?? {};
      for (const key of ["caption", "alt", "name", "title"]) {
        const value = props[key];
        if (typeof value === "string" && value.trim()) parts.push(value);
      }
      if (block.children) walk(block.children);
    }
  };

  walk(blocks);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function validateDocument(body: unknown): Block[] {
  if (!Array.isArray(body)) {
    throw new ApiError("validation_failed", "Тело документа должно быть списком блоков");
  }
  const seen = new Set<string>();
  const check = (blocks: Block[], depth: number) => {
    if (depth > 10) {
      throw new ApiError("validation_failed", "Слишком глубокая вложенность блоков");
    }
    for (const block of blocks) {
      if (typeof block !== "object" || block === null) {
        throw new ApiError("validation_failed", "Блок должен быть объектом");
      }
      if (block.id) {
        if (seen.has(block.id)) {
          throw new ApiError("validation_failed", "Повторяющийся идентификатор блока", {
            block_id: block.id,
          });
        }
        seen.add(block.id);
      }
      if (block.children) check(block.children, depth + 1);
    }
  };
  check(body as Block[], 0);
  return body as Block[];
}

/**
 * Вхождения сущностей в документ: блок-карточка и упоминание в строке.
 * Порядок берётся обходом документа — второго порядка не существует.
 */
export interface EntityRef {
  occurrenceId: string;
  blockId: string | null;
  entityId: number;
  displayMode: "card" | "inline";
  mediaAssetId: string | null;
  targetBlockId: string | null;
  note: string | null;
  ordinal: number;
}

/**
 * Пустая строка в свойствах блока — это «не задано», а не значение.
 * Редактор хранит незаполненные свойства пустыми строками, и такая строка,
 * попав в колонку с UUID, роняла сохранение текста внутренней ошибкой.
 */
function orNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

export function extractRefs(blocks: unknown): EntityRef[] {
  const refs: EntityRef[] = [];
  let ordinal = 0;

  const take = (
    props: Record<string, unknown>,
    blockId: string | null,
    mode: "card" | "inline",
  ) => {
    const entityId = Number(props.entityId ?? props.entity_id);
    if (!Number.isInteger(entityId) || entityId <= 0) return;
    refs.push({
      occurrenceId: orNull(props.occurrenceId ?? props.occurrence_id) ?? crypto.randomUUID(),
      blockId: orNull(blockId),
      entityId,
      displayMode: mode,
      mediaAssetId: orNull(props.mediaAssetId ?? props.media_asset_id),
      targetBlockId: orNull(props.targetBlockId ?? props.target_block_id),
      note: orNull(props.note),
      ordinal: ordinal++,
    });
  };

  const walkInline = (content: unknown, blockId: string | null) => {
    if (!Array.isArray(content)) return;
    for (const item of content) {
      if (!item || typeof item !== "object") continue;
      const node = item as { type?: string; props?: Record<string, unknown>; content?: unknown };
      if (node.type === "entityMention" && node.props) take(node.props, blockId, "inline");
      if (node.content) walkInline(node.content, blockId);
    }
  };

  const walk = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const block = item as {
        id?: string;
        type?: string;
        props?: Record<string, unknown>;
        content?: unknown;
        children?: unknown;
      };
      if (block.type === "entityCard" && block.props) {
        take(block.props, block.id ?? null, "card");
      }
      walkInline(block.content, block.id ?? null);
      if (block.children) walk(block.children);
    }
  };

  walk(blocks);
  return refs;
}

/**
 * Записываем указатель вхождений в одной транзакции с версией и проверяем,
 * что упомянутые сущности существуют: ссылка в никуда не сохраняется.
 */
async function saveRefs(tx: Tx, revisionId: string, blocks: unknown) {
  const refs = extractRefs(blocks);
  if (refs.length === 0) return;

  const ids = [...new Set(refs.map((ref) => ref.entityId))];
  const found = await tx<{ id: number }>`
    select id from app.entities where id = any(${ids}::bigint[])
  `;
  const known = new Set(found.map((row) => Number(row.id)));
  const missing = ids.filter((id) => !known.has(id));
  if (missing.length > 0) {
    throw new ApiError("validation_failed", "В тексте есть ссылки на несуществующие объекты", {
      entity_ids: missing,
    });
  }

  for (const ref of refs) {
    await tx`
      insert into app.document_entity_refs (revision_id, occurrence_id, block_id, entity_id,
                                            display_mode, media_asset_id, target_block_id,
                                            note, ordinal)
      values (${revisionId}, ${ref.occurrenceId}, ${ref.blockId}, ${ref.entityId},
              ${ref.displayMode}, ${ref.mediaAssetId}, ${ref.targetBlockId},
              ${ref.note}, ${ref.ordinal})
      on conflict (revision_id, occurrence_id) do nothing
    `;
  }
}

async function saveSearchText(tx: Tx, documentId: number, text: string) {
  await tx`
    update app.documents
       set body_text = ${text},
           search_vector = setweight(to_tsvector('russian', coalesce(title, '')), 'A')
                        || setweight(to_tsvector('russian', ${text}), 'B')
     where id = ${documentId}
  `;
}

/** Создание документа и, по желанию, прикрепление его к сущности. */
documents.post("/", async (c: Context<AppEnv>) => {
  const principal = requirePermission(c.get("principal"), "create_delete");
  const input = await c.req.json<{
    title?: string;
    lang?: string;
    body: unknown;
    attach_to_entity_id?: number;
    role?: string;
  }>();

  const blocks = validateDocument(input.body ?? []);
  const text = extractText(blocks);

  const result = await transaction(principal.contributorId, async (tx) => {
    const created = await tx<{ id: number }>`
      insert into app.documents (title, lang, body_format, body_schema_version, body_json)
      values (${input.title ?? null}, ${input.lang ?? "ru"}, 'blocknote',
              ${config.blockNoteSchemaVersion}, ${JSON.stringify(blocks)}::jsonb)
      returning id
    `;
    const documentId = Number(created[0].id);
    await saveSearchText(tx, documentId, text);

    const materials = await tx<{ id: string }>`
      insert into app.materials (kind, document_id, created_by)
      values ('document', ${documentId}, ${principal.contributorId}) returning id
    `;
    await tx`
      insert into app.material_credits (material_id, contributor_id, credit_role)
      values (${materials[0].id}, ${principal.contributorId}, 'author')
    `;
    const revisions = await tx<{ id: string }>`
      insert into app.revisions (material_id, edited_by, operation, summary, snapshot)
      values (${materials[0].id}, ${principal.contributorId}, 'create', 'Создание текста',
              ${JSON.stringify({ title: input.title ?? null, body_json: blocks })}::jsonb)
      returning id
    `;
    await saveRefs(tx, revisions[0].id, blocks);

    if (input.attach_to_entity_id) {
      const targets = await tx<{ id: number }>`
        select id from app.targets where entity_id = ${input.attach_to_entity_id}
      `;
      if (targets.length === 0) {
        throw new ApiError("not_found", "Сущность для прикрепления не найдена");
      }
      await tx`
        insert into app.attachments (target_id, role_id, document_id)
        values (${targets[0].id},
                (select id from app.attachment_roles where code = ${input.role ?? "description"}),
                ${documentId})
      `;
    }

    return { id: documentId, material_id: materials[0].id, revision_id: revisions[0].id };
  });

  return c.json(result, 201);
});

documents.get("/:id", async (c: Context<AppEnv>) => {
  const principal = c.get("principal");
  const id = Number(c.req.param("id"));
  const rows = await sql<Record<string, unknown>>`
    select d.id, d.title, d.lang, d.body_format, d.body_schema_version, d.body_json,
           d.updated_at, m.id as material_id, m.status as material_status,
           (select r.id from app.revisions r where r.material_id = m.id
             order by r.created_at desc limit 1) as latest_revision_id
    from app.documents d
    left join app.materials m on m.document_id = d.id
    where d.id = ${id}
  `;
  if (rows.length === 0) throw new ApiError("not_found", "Текст не найден");
  const document = rows[0];
  if (document.material_status !== "published" && !canSeeDrafts(principal)) {
    throw new ApiError("not_found", "Текст не найден");
  }
  return c.json(document);
});

documents.patch("/:id", async (c: Context<AppEnv>) => {
  const principal = requirePermission(c.get("principal"), "edit");
  const id = Number(c.req.param("id"));
  const input = await c.req.json<{ title?: string; body?: unknown; base_revision_id?: string }>();
  const baseRevisionId = input.base_revision_id ?? c.req.header("if-match");
  if (!baseRevisionId) {
    throw new ApiError("validation_failed", "Укажите версию, от которой выполняется правка");
  }
  const blocks = input.body === undefined ? null : validateDocument(input.body);

  return c.json(await transaction(principal.contributorId, async (tx) => {
    const current = await tx<{ material_id: string; latest_revision_id: string | null }>`
      select m.id as material_id,
             (select r.id from app.revisions r where r.material_id = m.id
               order by r.created_at desc limit 1) as latest_revision_id
      from app.materials m where m.document_id = ${id} for update
    `;
    if (current.length === 0) throw new ApiError("not_found", "Текст не найден");
    const { material_id, latest_revision_id } = current[0];
    if (latest_revision_id && latest_revision_id !== baseRevisionId) {
      throw new ApiError("version_conflict", "Текст изменён другим редактором", {
        latest_revision_id,
      });
    }

    await tx`
      update app.documents
         set title = coalesce(${input.title ?? null}, title),
             body_json = coalesce(${blocks === null ? null : JSON.stringify(blocks)}::jsonb, body_json)
       where id = ${id}
    `;
    const updated = await tx<{ body_json: unknown; title: string | null }>`
      select body_json, title from app.documents where id = ${id}
    `;
    await saveSearchText(tx, id, extractText(updated[0].body_json));

    const revisions = await tx<{ id: string }>`
      insert into app.revisions (material_id, base_revision_id, edited_by, operation, summary, snapshot)
      values (${material_id}, ${latest_revision_id}, ${principal.contributorId}, 'edit',
              'Правка текста',
              ${JSON.stringify({ title: updated[0].title, body_json: updated[0].body_json })}::jsonb)
      returning id
    `;
    await saveRefs(tx, revisions[0].id, updated[0].body_json);
    return { id, material_id, revision_id: revisions[0].id };
  }));
});
