/**
 * Карточка записи так, как её видит гость (Р-65).
 *
 * Отсюда берут данные готовый HTML страницы записи, её разметка schema.org
 * и ссылка «как цитировать». Всё отбирается по правилу гостя: только
 * опубликованное — сама запись, связанные с ней записи, текст, файлы
 * и источники.
 */
import { sql } from "./db.ts";
import { extractRefs } from "../routes/documents.ts";
import type { RefTarget } from "./blocksHtml.ts";

export interface Resolved {
  id: number;
  slug: string;
  isPublished: boolean;
  /** Адрес устарел или записан номером: вести на текущий слаг. */
  moved: boolean;
}

/**
 * Запись по адресу: слаг, прежний слаг из истории или номер.
 * Прежние адреса не умирают — они ведут на текущий (Р-65).
 */
export async function resolveEntity(key: string): Promise<Resolved | null> {
  const numeric = /^\d+$/.test(key);
  const rows = numeric
    ? await sql<{ id: number; slug: string; is_published: boolean }>`
        select id, slug, is_published from app.entities where id = ${Number(key)}`
    : await sql<{ id: number; slug: string; is_published: boolean }>`
        select id, slug, is_published from app.entities where slug = ${key}`;
  if (rows.length > 0) {
    const row = rows[0];
    return { id: Number(row.id), slug: row.slug, isPublished: row.is_published, moved: numeric };
  }
  if (numeric) return null;
  const history = await sql<{ id: number; slug: string; is_published: boolean }>`
    select e.id, e.slug, e.is_published
      from app.slug_history h join app.entities e on e.id = h.entity_id
     where h.slug = ${key}
  `;
  if (history.length === 0) return null;
  const row = history[0];
  return { id: Number(row.id), slug: row.slug, isPublished: row.is_published, moved: true };
}

export interface CardValue {
  parameter: string;
  title: string;
  unit: string | null;
  value_type: string;
  num_value: string | number | null;
  text_value: string | null;
  bool_value: boolean | null;
  option_title: string | null;
  place: Record<string, unknown> | null;
  date_start_year: number | null;
  date_end_year: number | null;
  is_approximate: boolean | null;
  is_ongoing: boolean | null;
}

export interface PublicCard {
  id: number;
  slug: string;
  title_ru: string;
  title_en: string | null;
  title_original: string | null;
  title_la: string | null;
  type: string;
  type_title: string;
  /** Путь по дереву типов от корневой ветви вниз. */
  type_path: { code: string; title: string }[];
  published_at: string | null;
  modified_at: string;
  values: CardValue[];
  tags: string[];
  media: PublicImage[];
  document: { body_json: unknown } | null;
  links: {
    other_id: number;
    other_slug: string;
    other_title: string;
    other_root: string;
    role: string | null;
    role_title: string | null;
    direction: "incoming" | "outgoing";
    justification: string | null;
  }[];
  mentions: { document_title: string | null; owner_slug: string | null; owner_title: string | null }[];
  sources: {
    kind: string;
    kind_title: string;
    title: string | null;
    text: string | null;
    url: string | null;
    year: number | null;
  }[];
  authors: string[];
  /** Опубликованные записи, упомянутые в тексте: номер → адрес. */
  refs: Map<number, RefTarget>;
  /** Файлы из текста, которые можно показать гостю, с их подписью. */
  publicAssets: Map<string, PublicImage>;
}

/**
 * Открытое изображение с обязательной подписью (Р-68): показываем по праву
 * цитирования в учебных целях, поэтому автор и источник идут всюду, где идёт
 * картинка, — в подписи под ней и в разметке schema.org.
 */
export interface PublicImage {
  asset_id: string;
  caption: string | null;
  /** Автор произведения или съёмки, иначе правообладатель. */
  author: string | null;
  /** Подпись из источника или место хранения. */
  source: string | null;
  source_url: string | null;
}

/** Опубликованная запись целиком; черновик и архив гостю не существуют. */
export async function loadPublicCard(id: number): Promise<PublicCard | null> {
  const rows = await sql<Record<string, unknown>>`
    select e.id, e.slug, e.title_ru, e.title_en, e.title_original, e.title_la,
           ty.code as type, ty.title_ru as type_title,
           app.entity_type_path(e.type_id) as type_path,
           (select r.created_at from app.revisions r where r.id = m.published_revision_id)
             as published_at,
           greatest(e.updated_at,
                    (select max(r.created_at) from app.revisions r where r.material_id = m.id))
             as modified_at
      from app.entities e
      join app.entity_types ty on ty.id = e.type_id
      left join app.materials m on m.entity_id = e.id
     where e.id = ${id} and e.is_published
  `;
  if (rows.length === 0) return null;
  const e = rows[0];

  const values = await sql<CardValue>`
    select p.code as parameter, p.title_ru as title, p.unit, p.value_type,
           iv.num_value, iv.text_value, iv.bool_value,
           (select o.title_ru from app.parameter_options o where o.id = iv.option_id) as option_title,
           (select to_jsonb(pl) from app.places pl where pl.id = iv.place_id) as place,
           iv.date_start_year, iv.date_end_year, iv.is_approximate, iv.is_ongoing
      from app.indicators i
      join app.indicator_values iv on iv.indicator_id = i.id
      join app.parameters p on p.id = iv.parameter_id
     where i.entity_id = ${id} and i.is_current
     order by i.sort_order, i.id, p.sort_order, p.title_ru, iv.sort_order
  `;

  const tags = await sql<{ title: string }>`
    select t.title from app.entity_tags et join app.tags t on t.id = et.tag_id
     where et.entity_id = ${id} order by t.title
  `;

  // Только открытые и опубликованные файлы: закрытый файл гостю не отдаётся,
  // и ссылка на него в разметке вела бы в 404. Открытым файл бывает только
  // с автором и источником (Р-68) — второго условия здесь не нужно.
  const media = await sql<PublicImage>`
    select a.asset_id, ma.caption_ru as caption,
           coalesce(nullif(ma.author, ''), nullif(ma.credit, '')) as author,
           coalesce(nullif(ma.original_caption, ''), nullif(ma.holder, '')) as source,
           nullif(ma.source_url, '') as source_url
      from app.attachments a
      join app.targets t on t.id = a.target_id
      join app.media_assets ma on ma.id = a.asset_id
     where t.entity_id = ${id} and ma.is_published and ma.visibility = 'public'
       and ma.archived_at is null
     order by a.sort_order, a.id
  `;

  const documents = await sql<{ id: number; body_json: unknown }>`
    select d.id, d.body_json
      from app.attachments a
      join app.targets t on t.id = a.target_id
      join app.attachment_roles ar on ar.id = a.role_id
      join app.documents d on d.id = a.document_id
      join app.materials dm on dm.document_id = d.id
     where t.entity_id = ${id} and ar.code in ('description', 'wiki')
       and dm.status = 'published'
     order by a.sort_order, a.id
     limit 1
  `;
  const document = documents[0] ?? null;

  const links = await sql<PublicCard["links"][number]>`
    select other.id as other_id, other.slug as other_slug, other.title_ru as other_title,
           (app.entity_type_path(other.type_id) -> 0 ->> 'code') as other_root,
           lr.code as role, lr.title_ru as role_title,
           case when l.from_entity_id = ${id} then 'outgoing' else 'incoming' end as direction,
           (select d.body_text from app.attachments a
              join app.targets t on t.id = a.target_id
              join app.attachment_roles ar on ar.id = a.role_id
              join app.documents d on d.id = a.document_id
             where t.link_id = l.id and ar.code = 'justification'
             order by a.sort_order limit 1) as justification
      from app.links l
      join app.entities other
        on other.id = case when l.from_entity_id = ${id} then l.to_entity_id
                           else l.from_entity_id end
      left join app.link_roles lr on lr.id = l.role_id
     where (l.from_entity_id = ${id} or l.to_entity_id = ${id}) and other.is_published
     order by l.is_primary desc, l.sort_order, l.id
  `;

  // Где запись упоминается: текст и запись, которой он принадлежит (лекция).
  const mentions = await sql<PublicCard["mentions"][number]>`
    select distinct on (pm.document_id) pm.document_title,
           owner.slug as owner_slug, owner.title_ru as owner_title
      from app.published_entity_mentions pm
      left join app.attachments a on a.document_id = pm.document_id
      left join app.targets t on t.id = a.target_id
      left join app.entities owner on owner.id = t.entity_id and owner.is_published
     where pm.entity_id = ${id}
     order by pm.document_id, owner.id nulls last
  `;

  const sources = await sql<PublicCard["sources"][number]>`
    select rk.code as kind, rk.title_ru as kind_title, ri.title, ri.text, ri.url, ri.year
      from app.attachments a
      join app.targets t on t.id = a.target_id
      join app.reference_items ri on ri.id = a.reference_item_id
      join app.reference_kinds rk on rk.id = ri.kind_id
     where t.entity_id = ${id} and ri.is_published
     order by a.sort_order, ri.sort_order, ri.id
  `;

  // Авторы материала — подписи карточки и её текста, без повторов. Тот же
  // расчёт, что в ответе клиенту: «как цитировать» везде одно.
  const authors = await entityAuthors(id);

  // Ссылки из текста — только на опубликованное; прочее остаётся словами.
  const refs = new Map<number, RefTarget>();
  const publicAssets = new Map<string, PublicImage>(media.map((m) => [m.asset_id, m]));
  if (document) {
    const ids = [...new Set(extractRefs(document.body_json).map((ref) => ref.entityId))];
    if (ids.length > 0) {
      const found = await sql<{ id: number; slug: string; title_ru: string }>`
        select id, slug, title_ru from app.entities
         where id = any(${ids}::bigint[]) and is_published
      `;
      for (const row of found) refs.set(Number(row.id), { slug: row.slug, title: row.title_ru });
    }
    const assetIds = collectAssets(document.body_json);
    if (assetIds.length > 0) {
      const open = await sql<PublicImage>`
        select ma.id as asset_id, ma.caption_ru as caption,
               coalesce(nullif(ma.author, ''), nullif(ma.credit, '')) as author,
               coalesce(nullif(ma.original_caption, ''), nullif(ma.holder, '')) as source,
               nullif(ma.source_url, '') as source_url
          from app.media_assets ma
         where ma.id = any(${assetIds}::uuid[]) and ma.is_published
           and ma.visibility = 'public' and ma.archived_at is null
      `;
      for (const row of open) publicAssets.set(row.asset_id, row);
    }
  }

  return {
    id: Number(e.id),
    slug: e.slug as string,
    title_ru: e.title_ru as string,
    title_en: e.title_en as string | null,
    title_original: e.title_original as string | null,
    title_la: e.title_la as string | null,
    type: e.type as string,
    type_title: e.type_title as string,
    type_path: (e.type_path ?? []) as PublicCard["type_path"],
    published_at: e.published_at ? String(e.published_at) : null,
    modified_at: String(e.modified_at),
    values,
    tags: tags.map((t) => t.title),
    media,
    document,
    links,
    mentions,
    sources,
    authors,
    refs,
    publicAssets,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function collectAssets(list: unknown): string[] {
  const found: string[] = [];
  const walk = (items: unknown) => {
    if (!Array.isArray(items)) return;
    for (const item of items as { type?: string; props?: { assetId?: string }; children?: unknown }[]) {
      const assetId = item?.props?.assetId;
      if (item?.type === "mediaImage" && assetId && UUID.test(assetId)) found.push(assetId);
      if (item?.children) walk(item.children);
    }
  };
  walk(list);
  return [...new Set(found)];
}

/** Подписи материала записи: для «как цитировать» в ответе клиенту. */
export async function entityAuthors(entityId: number): Promise<string[]> {
  const rows = await sql<{ display_name: string }>`
    select c.display_name
      from app.materials m
      join app.material_credits mc on mc.material_id = m.id
      join app.contributors c on c.id = mc.contributor_id
     where (m.entity_id = ${entityId}
            or m.document_id in (select a.document_id from app.attachments a
                                   join app.targets t on t.id = a.target_id
                                   join app.attachment_roles ar on ar.id = a.role_id
                                  where t.entity_id = ${entityId}
                                    and ar.code in ('description', 'wiki')))
       and mc.credit_role in ('author', 'coauthor')
     group by c.id, c.display_name
     order by min(case mc.credit_role when 'author' then 0 else 1 end), c.display_name
  `;
  return rows.map((r) => r.display_name);
}
