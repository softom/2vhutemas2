/**
 * Связи между сущностями.
 *
 * Принятое правило проекта: связь не существует без обоснования. Поэтому
 * создание связи, её описание и прикрепление обоснования — одна транзакция,
 * а в БД это стережёт отложенное ограничение. Автор может связать что угодно
 * с чем угодно, но обязан объяснить, на каком основании.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { sql, transaction } from "../lib/db.ts";
import { ApiError } from "../lib/errors.ts";
import { require as requirePermission } from "../lib/auth.ts";
import type { AppEnv } from "../lib/http.ts";
import { extractText } from "./documents.ts";

export const links = new Hono<AppEnv>();

interface LinkInput {
  from_entity_id: number;
  to_entity_id: number;
  role?: string | null;
  note?: string | null;
  is_primary?: boolean;
  confidence?: string | null;
  /** Обоснование: блоки BlockNote либо простой текст. Пустым быть не может. */
  justification: { title?: string; body?: unknown; text?: string };
}

function justificationBlocks(input: LinkInput): unknown[] {
  const body = input.justification?.body;
  if (Array.isArray(body) && body.length > 0) return body;

  const plain = input.justification?.text?.trim();
  if (plain) {
    return [{
      id: crypto.randomUUID(),
      type: "paragraph",
      content: [{ type: "text", text: plain, styles: {} }],
    }];
  }
  throw new ApiError(
    "link_requires_justification",
    "Связь нельзя создать без обоснования: объясните, на каком основании объекты связаны",
  );
}

links.post("/", async (c: Context<AppEnv>) => {
  const principal = requirePermission(c.get("principal"), "create_delete");
  const input = await c.req.json<LinkInput>();

  if (!Number.isInteger(input.from_entity_id) || !Number.isInteger(input.to_entity_id)) {
    throw new ApiError("validation_failed", "Не указаны связываемые сущности");
  }
  if (input.from_entity_id === input.to_entity_id) {
    throw new ApiError("validation_failed", "Нельзя связать сущность с самой собой");
  }
  const blocks = justificationBlocks(input);

  const result = await transaction(principal.contributorId, async (tx) => {
    const existing = await tx<{ id: number }>`
      select id from app.entities where id in (${input.from_entity_id}, ${input.to_entity_id})
    `;
    if (existing.length < 2) throw new ApiError("not_found", "Одна из сущностей не найдена");

    const created = await tx<{ id: number }>`
      insert into app.links (from_entity_id, to_entity_id, role_id, note, is_primary, confidence)
      values (${input.from_entity_id}, ${input.to_entity_id},
              (select id from app.link_roles where code = ${input.role ?? null}),
              ${input.note ?? null}, ${input.is_primary ?? false}, ${input.confidence ?? null})
      returning id
    `;
    const linkId = Number(created[0].id);

    const documents = await tx<{ id: number }>`
      insert into app.documents (title, body_json, body_text, body_format, body_schema_version)
      values (${input.justification?.title ?? "Обоснование связи"},
              ${JSON.stringify(blocks)}::jsonb, ${extractText(blocks)}, 'blocknote', 1)
      returning id
    `;

    // Цель связи создаёт триггер при вставке; берём её и прикрепляем обоснование.
    await tx`
      insert into app.attachments (target_id, role_id, document_id)
      select t.id, (select id from app.attachment_roles where code = 'justification'),
             ${documents[0].id}
        from app.targets t where t.link_id = ${linkId}
    `;

    const materials = await tx<{ id: string }>`
      insert into app.materials (kind, link_id, created_by)
      values ('link', ${linkId}, ${principal.contributorId}) returning id
    `;
    await tx`
      insert into app.material_credits (material_id, contributor_id, credit_role)
      values (${materials[0].id}, ${principal.contributorId}, 'author')
    `;
    await tx`
      insert into app.revisions (material_id, edited_by, operation, summary, snapshot)
      values (${materials[0].id}, ${principal.contributorId}, 'create', 'Создание связи',
              ${JSON.stringify({ link: input, justification: blocks })}::jsonb)
    `;

    return { id: linkId, document_id: documents[0].id, material_id: materials[0].id };
  });

  return c.json(result, 201);
});

/** Окружение объекта: связи в обе стороны вместе с обоснованиями. */
links.get("/", async (c: Context<AppEnv>) => {
  const entityId = Number(c.req.query("entity_id"));
  if (!Number.isInteger(entityId)) {
    throw new ApiError("validation_failed", "Укажите entity_id");
  }

  const rows = await sql<Record<string, unknown>>`
    select l.id, l.from_entity_id, l.to_entity_id, l.note, l.is_primary, l.confidence,
           (select code from app.link_roles lr where lr.id = l.role_id) as role,
           case when l.from_entity_id = ${entityId} then 'outgoing' else 'incoming' end as direction,
           other.id   as other_id,
           other.slug as other_slug,
           other.title_ru as other_title,
           (select ty.code from app.entity_types ty where ty.id = other.type_id) as other_type,
           (select ty.title_ru from app.entity_types ty where ty.id = other.type_id)
             as other_type_title,
           -- Обложка связанной записи — её первое прикреплённое изображение (Р-36).
           (select a.asset_id from app.attachments a
              join app.targets t on t.id = a.target_id
             where t.entity_id = other.id and a.asset_id is not null
             order by a.sort_order, a.id limit 1) as other_cover_media_id,
           (select d.body_text from app.attachments a
              join app.targets t on t.id = a.target_id
              join app.attachment_roles ar on ar.id = a.role_id
              join app.documents d on d.id = a.document_id
             where t.link_id = l.id and ar.code = 'justification'
             order by a.sort_order limit 1) as justification
    from app.links l
    join app.entities other
      on other.id = case when l.from_entity_id = ${entityId} then l.to_entity_id
                         else l.from_entity_id end
    where l.from_entity_id = ${entityId} or l.to_entity_id = ${entityId}
    order by l.is_primary desc, l.sort_order, l.id
  `;
  return c.json({ items: rows });
});

/** Упоминания сущности в опубликованных материалах. */
links.get("/mentions", async (c: Context<AppEnv>) => {
  const entityId = Number(c.req.query("entity_id"));
  if (!Number.isInteger(entityId)) {
    throw new ApiError("validation_failed", "Укажите entity_id");
  }
  const rows = await sql<Record<string, unknown>>`
    select document_id, document_title,
           count(*)::int as occurrences,
           min(ordinal)  as first_ordinal,
           bool_or(display_mode = 'card') as has_card
    from app.published_entity_mentions
    where entity_id = ${entityId}
    group by document_id, document_title
    order by document_title
  `;
  return c.json({ items: rows });
});

links.delete("/:id", async (c: Context<AppEnv>) => {
  const principal = requirePermission(c.get("principal"), "create_delete");
  const linkId = Number(c.req.param("id"));

  await transaction(principal.contributorId, async (tx) => {
    const materials = await tx<{ id: string }>`
      select id from app.materials where link_id = ${linkId}
    `;
    if (materials.length > 0) {
      await tx`
        insert into app.revisions (material_id, edited_by, operation, summary, snapshot)
        values (${materials[0].id}, ${principal.contributorId}, 'archive', 'Удаление связи',
                ${JSON.stringify({ link_id: linkId })}::jsonb)
      `;
    }
    const removed = await tx`delete from app.links where id = ${linkId} returning id`;
    if (removed.length === 0) throw new ApiError("not_found", "Связь не найдена");
  });

  return c.body(null, 204);
});
