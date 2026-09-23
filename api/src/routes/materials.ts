/**
 * Публикация и рассмотрение версий (решения Р-03, Р-04).
 *
 * Состояние материала — его атрибут: черновик, опубликован, архив. Что видит
 * читатель, определяет указатель опубликованной версии: правка опубликованного
 * материала создаёт версию, но до публикации читателю видно прежнее.
 *
 * Право `publish` публикует свою версию сразу. Без него правка отправляется
 * на рассмотрение обладателю права `review`, и материал остаётся прежним.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { sql, transaction, type Tx } from "../lib/db.ts";
import { ApiError } from "../lib/errors.ts";
import { can, require as requirePermission } from "../lib/auth.ts";
import type { AppEnv } from "../lib/http.ts";

export const materials = new Hono<AppEnv>();

interface MaterialRow {
  id: string;
  status: "draft" | "published" | "archived";
  kind: string;
  published_revision_id: string | null;
  latest_revision_id: string | null;
}

async function loadMaterial(tx: Tx, materialId: string): Promise<MaterialRow> {
  const rows = await tx<MaterialRow>`
    select m.id, m.status, m.kind, m.published_revision_id,
           (select r.id from app.revisions r where r.material_id = m.id
             order by r.created_at desc limit 1) as latest_revision_id
    from app.materials m where m.id = ${materialId}
    for update
  `;
  if (rows.length === 0) throw new ApiError("not_found", "Материал не найден");
  return rows[0];
}

/** Состояние материала: что опубликовано, что предложено, как рассматривали. */
materials.get("/:id", async (c: Context<AppEnv>) => {
  const materialId = c.req.param("id");
  const rows = await sql<Record<string, unknown>>`
    select m.id, m.status, m.kind, m.published_revision_id, m.archived_at,
           (select r.id from app.revisions r where r.material_id = m.id
             order by r.created_at desc limit 1) as latest_revision_id,
           (select count(*) from app.revisions r where r.material_id = m.id) as revisions,
           coalesce((select jsonb_agg(jsonb_build_object(
                        'decision', rr.decision, 'note', rr.note, 'created_at', rr.created_at)
                        order by rr.created_at)
                     from app.revision_reviews rr
                     join app.revisions r on r.id = rr.revision_id
                    where r.material_id = m.id), '[]'::jsonb) as reviews
    from app.materials m where m.id = ${materialId}
  `;
  if (rows.length === 0) throw new ApiError("not_found", "Материал не найден");

  const material = rows[0] as unknown as { status: string };
  if (material.status !== "published" && !can(c.get("principal"), "view")) {
    throw new ApiError("not_found", "Материал не найден");
  }
  return c.json(material);
});

/** Публикация: требует права publish. Указатель и состояние меняются вместе. */
materials.post("/:id/publish", async (c: Context<AppEnv>) => {
  const principal = requirePermission(c.get("principal"), "publish");
  const materialId = c.req.param("id");
  const input = await c.req.json<{ revision_id?: string; note?: string }>().catch(() => ({}));

  const result = await transaction(principal.contributorId, async (tx) => {
    const material = await loadMaterial(tx, materialId);
    const revisionId = input.revision_id ?? material.latest_revision_id;
    if (!revisionId) {
      throw new ApiError("validation_failed", "У материала нет ни одной версии");
    }

    const belongs = await tx<{ id: string }>`
      select id from app.revisions where id = ${revisionId} and material_id = ${materialId}
    `;
    if (belongs.length === 0) {
      throw new ApiError("validation_failed", "Версия принадлежит другому материалу");
    }
    if (material.published_revision_id === revisionId && material.status === "published") {
      throw new ApiError("duplicate", "Эта версия уже опубликована");
    }

    await tx`
      update app.materials
         set status = 'published', published_revision_id = ${revisionId}, archived_at = null
       where id = ${materialId}
    `;
    await tx`
      insert into app.revision_reviews (revision_id, reviewer_id, decision, note)
      values (${revisionId}, ${principal.contributorId}, 'published', ${input.note ?? null})
    `;
    return { material_id: materialId, published_revision_id: revisionId, status: "published" };
  });

  return c.json(result);
});

/**
 * Отправка версии на рассмотрение: для тех, у кого нет права публиковать.
 * Материал при этом не меняется — читатель продолжает видеть прежнее.
 */
materials.post("/:id/submit", async (c: Context<AppEnv>) => {
  const principal = requirePermission(c.get("principal"), "edit");
  const materialId = c.req.param("id");
  const input = await c.req.json<{ note?: string }>().catch(() => ({}));

  const result = await transaction(principal.contributorId, async (tx) => {
    const material = await loadMaterial(tx, materialId);
    if (!material.latest_revision_id) {
      throw new ApiError("validation_failed", "У материала нет ни одной версии");
    }
    await tx`
      insert into app.revision_reviews (revision_id, reviewer_id, decision, note)
      values (${material.latest_revision_id}, ${principal.contributorId}, 'submitted',
              ${input.note ?? null})
    `;
    return { material_id: materialId, revision_id: material.latest_revision_id };
  });

  return c.json(result);
});

/** Решение по чужой версии: принять — значит опубликовать. */
materials.post("/:id/review", async (c: Context<AppEnv>) => {
  const principal = requirePermission(c.get("principal"), "review");
  const materialId = c.req.param("id");
  const input = await c.req.json<{ decision: "approved" | "rejected"; note?: string }>();
  if (input.decision !== "approved" && input.decision !== "rejected") {
    throw new ApiError("validation_failed", "Решение может быть approved или rejected");
  }

  const result = await transaction(principal.contributorId, async (tx) => {
    const material = await loadMaterial(tx, materialId);
    const revisionId = material.latest_revision_id;
    if (!revisionId) throw new ApiError("validation_failed", "У материала нет ни одной версии");

    await tx`
      insert into app.revision_reviews (revision_id, reviewer_id, decision, note)
      values (${revisionId}, ${principal.contributorId}, ${input.decision}, ${input.note ?? null})
    `;

    if (input.decision === "approved") {
      await tx`
        update app.materials
           set status = 'published', published_revision_id = ${revisionId}
         where id = ${materialId}
      `;
      await tx`
        insert into app.revision_reviews (revision_id, reviewer_id, decision, note)
        values (${revisionId}, ${principal.contributorId}, 'published', 'Принято при рассмотрении')
      `;
    }
    return { material_id: materialId, decision: input.decision };
  });

  return c.json(result);
});

/** Архивирование: материал уходит из показа, история и файлы остаются. */
materials.delete("/:id", async (c: Context<AppEnv>) => {
  const principal = requirePermission(c.get("principal"), "create_delete");
  const materialId = c.req.param("id");

  await transaction(principal.contributorId, async (tx) => {
    const material = await loadMaterial(tx, materialId);
    await tx`
      update app.materials
         set status = 'archived', archived_at = now(), published_revision_id = null
       where id = ${materialId}
    `;
    if (material.latest_revision_id) {
      await tx`
        insert into app.revisions (material_id, base_revision_id, edited_by, operation, summary, snapshot)
        values (${materialId}, ${material.latest_revision_id}, ${principal.contributorId},
                'archive', 'Архивирование', '{}'::jsonb)
      `;
    }
  });

  return c.body(null, 204);
});
