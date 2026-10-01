/**
 * Записи, которые заводятся не формой карточки, а удобными входами: место из
 * редактора адреса, изображение из медиатеки (Р-84, Р-85).
 *
 * Запись всё равно одна и та же: строка `entities` своего типа, сведения —
 * значения параметров, авторство — материал, история — версии. Здесь только
 * общие шаги, чтобы место и изображение заводились одинаково с любой другой
 * записью и не обрастали своими правилами.
 */
import type { Tx } from "./db.ts";
import { ApiError } from "./errors.ts";

/** Ответ параметра в сведениях записи. Пустой ответ означает «удалить». */
export interface ParamAnswer {
  code: string;
  text?: string | null;
  num?: number | null;
  option?: string | null;
}

/** Заводит запись с материалом и автором; версию создаёт `saveRevision`. */
export async function createRecord(
  tx: Tx,
  input: { type: string; title: string; slugBase?: string; contributorId: string },
): Promise<{ id: number; materialId: string }> {
  const types = await tx<{ id: string }>`select id from app.entity_types where code = ${input.type}`;
  if (types.length === 0) throw new ApiError("validation_failed", "Неизвестный тип записи", { type: input.type });

  const inserted = await tx<{ id: number }>`
    insert into app.entities (type_id, slug, title_ru)
    values (${types[0].id}, app.unique_slug(${input.slugBase ?? input.title}), ${input.title})
    returning id
  `;
  const id = Number(inserted[0].id);
  const materials = await tx<{ id: string }>`
    insert into app.materials (kind, entity_id, created_by)
    values ('entity', ${id}, ${input.contributorId}) returning id
  `;
  await tx`
    insert into app.material_credits (material_id, contributor_id, credit_role)
    values (${materials[0].id}, ${input.contributorId}, 'author')
  `;
  return { id, materialId: materials[0].id };
}

/**
 * Пишет ответы в группу «Сведения». Названные параметры заменяются целиком,
 * прочие сведения записи не трогаются.
 */
export async function setAnswers(tx: Tx, entityId: number, answers: ParamAnswer[]) {
  if (answers.length === 0) return;
  let group = await tx<{ id: string }>`
    select id from app.indicators where entity_id = ${entityId} and title = 'Сведения'
     order by is_current desc, sort_order, id limit 1
  `;
  if (group.length === 0) {
    group = await tx<{ id: string }>`
      insert into app.indicators (entity_id, title, is_current, sort_order)
      values (${entityId}, 'Сведения', true, 0) returning id
    `;
  }
  const indicatorId = group[0].id;

  for (const answer of answers) {
    const params = await tx<{ id: string; value_type: string }>`
      select id, value_type from app.parameters where code = ${answer.code}
    `;
    if (params.length === 0) throw new ApiError("internal_error", `Нет параметра ${answer.code}`);
    const parameter = params[0];
    await tx`delete from app.indicator_values where indicator_id = ${indicatorId} and parameter_id = ${parameter.id}`;

    const text = typeof answer.text === "string" ? answer.text.trim() : null;
    if (parameter.value_type === "text" && text) {
      await tx`insert into app.indicator_values (indicator_id, parameter_id, text_value)
               values (${indicatorId}, ${parameter.id}, ${text})`;
    } else if ((parameter.value_type === "number" || parameter.value_type === "integer") &&
      answer.num !== null && answer.num !== undefined && Number.isFinite(answer.num)) {
      await tx`insert into app.indicator_values (indicator_id, parameter_id, num_value)
               values (${indicatorId}, ${parameter.id}, ${answer.num})`;
    } else if (parameter.value_type === "option" && answer.option) {
      const options = await tx<{ id: string }>`
        select id from app.parameter_options where parameter_id = ${parameter.id} and code = ${answer.option}
      `;
      if (options.length === 0) {
        throw new ApiError("validation_failed", "Нет такого варианта ответа", {
          parameter: answer.code, option: answer.option,
        });
      }
      await tx`insert into app.indicator_values (indicator_id, parameter_id, option_id)
               values (${indicatorId}, ${parameter.id}, ${options[0].id})`;
    }
  }
}

/** Новая рабочая редакция: снимок собирает база из рабочей копии записи. */
export async function saveRevision(
  tx: Tx, entityId: number, contributorId: string, summary: string, operation = "edit",
): Promise<string> {
  const rows = await tx<{ id: string }>`
    insert into app.revisions (material_id, base_revision_id, edited_by, operation, summary, snapshot)
    select m.id, e.working_revision_id, ${contributorId}, ${operation}, ${summary}, '{}'::jsonb
      from app.entities e join app.materials m on m.entity_id = e.id
     where e.id = ${entityId}
    returning id
  `;
  if (rows.length === 0) throw new ApiError("not_found", "Запись не найдена");
  return rows[0].id;
}

/** Публикует рабочую редакцию или снимает запись с публикации. */
export async function setPublished(tx: Tx, entityId: number, published: boolean) {
  if (published) {
    await tx`update app.entities set status = 'published', published_revision_id = working_revision_id
              where id = ${entityId}`;
  } else {
    await tx`update app.entities set status = 'draft', published_revision_id = null
              where id = ${entityId} and status <> 'archived'`;
  }
}

/** Обоснование одним абзацем: подпись иллюстрации, причина связи. */
export function paragraph(text: string): unknown[] {
  return [{ id: "p1", type: "paragraph", content: [{ type: "text", text, styles: {} }] }];
}

/**
 * Связь с обоснованием — как её заводит POST /links, но для удобных входов:
 * изображение, прикреплённое к записи, — связь «иллюстрация» (Р-84).
 */
export async function createLink(
  tx: Tx,
  input: {
    from: number; to: number; role: string; justification: string; contributorId: string;
    sortOrder?: number; isPrimary?: boolean; publish?: boolean;
  },
): Promise<number> {
  const links = await tx<{ id: number }>`
    insert into app.links (from_entity_id, to_entity_id, role_id, sort_order, is_primary)
    values (${input.from}, ${input.to}, (select id from app.link_roles where code = ${input.role}),
            ${input.sortOrder ?? 0}, ${input.isPrimary ?? false})
    returning id
  `;
  const linkId = Number(links[0].id);
  const materials = await tx<{ id: string }>`
    insert into app.materials (kind, link_id, created_by) values ('link', ${linkId}, ${input.contributorId})
    returning id
  `;
  await tx`insert into app.material_credits (material_id, contributor_id, credit_role)
           values (${materials[0].id}, ${input.contributorId}, 'author')`;
  await tx`
    insert into app.revisions (material_id, edited_by, operation, summary, snapshot)
    values (${materials[0].id}, ${input.contributorId}, 'create', 'Создание связи',
            ${JSON.stringify({ body_json: paragraph(input.justification) })}::jsonb)
  `;
  if (input.publish) await publishLinkWorking(tx, linkId);
  return linkId;
}

/**
 * Новая редакция связи после правки её полей (порядок, «главная»). Снимок
 * собирает база: поля связи из таблицы, обоснование — из прежней редакции.
 */
export async function saveLinkRevision(tx: Tx, linkId: number, contributorId: string, summary: string) {
  await tx`
    insert into app.revisions (material_id, base_revision_id, edited_by, operation, summary, snapshot)
    select m.id, l.working_revision_id, ${contributorId}, 'edit', ${summary}, '{}'::jsonb
      from app.links l join app.materials m on m.link_id = l.id
     where l.id = ${linkId}
  `;
}

export async function publishLinkWorking(tx: Tx, linkId: number) {
  await tx`update app.links set status = 'published', published_revision_id = working_revision_id
            where id = ${linkId}`;
}
