/**
 * Единая загрузка карточки (Р-74). По умолчанию — только публичные данные.
 *
 * Отсюда берут данные готовый HTML страницы записи, её разметка schema.org
 * и ссылка «как цитировать». Без principal отбирается только опубликованное;
 * редактору и рецензенту доступны черновики по canSeeDrafts. Проверяются — сама запись, связанные с ней записи, текст, файлы
 * и источники.
 */
import { sql } from "./db.ts";
import { canSeeDrafts, type Principal } from "./auth.ts";
import { extractRefs, extractText } from "../routes/documents.ts";
import type { CompactItem, RefTarget } from "./blocksHtml.ts";

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
export async function resolveEntity(key: string, drafts = false): Promise<Resolved | null> {
  const numeric = /^\d+$/.test(key);
  const rows = numeric
    ? await sql<{ id: number; slug: string; is_published: boolean }>`
        select id, slug, is_published from app.read_entities(${drafts}) where id = ${Number(key)}`
    : await sql<{ id: number; slug: string; is_published: boolean }>`
        select id, slug, is_published from app.read_entities(${drafts}) where slug = ${key}`;
  if (rows.length > 0) {
    const row = rows[0];
    return { id: Number(row.id), slug: row.slug, isPublished: row.is_published, moved: numeric };
  }
  if (numeric) return null;
  const history = await sql<{ id: number; slug: string; is_published: boolean }>`
    select e.id, e.slug, e.is_published
      from app.slug_history h join app.read_entities(${drafts}) e on e.id = h.entity_id
     where h.slug = ${key}
  `;
  if (history.length === 0) return null;
  const row = history[0];
  return { id: Number(row.id), slug: row.slug, isPublished: row.is_published, moved: true };
}

export interface CardValue {
  indicator_id: number;
  indicator_title: string;
  measured_year: number | null;
  is_current: boolean;
  parameter: string;
  title: string;
  unit: string | null;
  value_type: string;
  num_value: string | number | null;
  text_value: string | null;
  bool_value: boolean | null;
  option_title: string | null;
  /** Код варианта — по нему облик различает, например, темы новостей цветом. */
  option_code?: string | null;
  place: Record<string, unknown> | null;
  date_start_year: number | null;
  date_start_month?: number | null;
  date_start_day?: number | null;
  date_end_year: number | null;
  is_approximate: boolean | null;
  is_ongoing: boolean | null;
}

export interface PublicCard {
  is_published: boolean;
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
  /** Источники — связи «источник» с книгами, статьями, веб-страницами (Р-80). */
  sources: {
    kind: string;
    kind_title: string;
    title: string | null;
    slug: string | null;
    text: string | null;
    url: string | null;
    year: number | null;
  }[];
  /** Компоненты карточки по порядку — из таблицы отображений типа. */
  layout: string[];
  /** Кадр-превью ролика по его адресу (тип «Видео»); пусто у прочих записей. */
  video_cover: string | null;
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
export async function loadPublicCard(id: number, principal: Principal | null = null): Promise<PublicCard | null> {
  const drafts = canSeeDrafts(principal);
  const rows = await sql<Record<string, unknown>>`
    select e.id, e.is_published, e.slug, e.title_ru, e.title_en, e.title_original, e.title_la,
           ty.code as type, ty.title_ru as type_title,
           app.entity_type_path(e.type_id) as type_path,
           (select r.created_at from app.revisions r where r.id = e.published_revision_id)
             as published_at,
           greatest(e.updated_at,
                    (select r.created_at from app.revisions r where r.id = case when ${drafts} then e.working_revision_id else e.published_revision_id end))
             as modified_at
      from app.read_entities(${drafts}) e
      join app.entity_types ty on ty.id = e.type_id
      left join app.materials m on m.entity_id = e.id
     where e.id = ${id} and (${drafts} or e.is_published)
  `;
  if (rows.length === 0) return null;
  const e = rows[0];

  const values = await sql<CardValue>`
    select i.id as indicator_id, i.title as indicator_title, i.measured_year, i.is_current,
           p.code as parameter, p.title_ru as title, p.unit, app.api_value_type(p.id) as value_type,
           iv.num_value, iv.text_value, iv.bool_value,
           (select o.title_ru from app.parameter_options o where o.id = iv.option_id) as option_title,
           (select o.code from app.parameter_options o where o.id = iv.option_id) as option_code,
           -- Ответ-место — запись «Место» (Р-85); её сведения из той же
           -- редакции, которую видит спрашивающий.
           case when iv.entity_value_id is not null
                then app.place_json(iv.entity_value_id, ${drafts}) end as place,
           iv.date_start_year, iv.date_start_month, iv.date_start_day, iv.date_end_year, iv.is_approximate, iv.is_ongoing
      from app.read_indicators(${drafts}) i
      join app.read_values(${drafts}) iv on iv.indicator_id = i.id
      join app.parameters p on p.id = iv.parameter_id
     where i.entity_id = ${id} and p.value_type <> 'blocks'
     order by i.sort_order, i.id, p.sort_order, p.title_ru, iv.sort_order
  `;

  const tags = await sql<{ title: string }>`
    select t.title from app.read_entity_tags(${drafts}) et join app.tags t on t.id = et.tag_id
     where et.entity_id = ${id} order by t.title
  `;

  // Иллюстрации — связи с записями «Изображение» (Р-84). Гостю — только
  // опубликованные: файл неопубликованной записи не отдаётся, и ссылка на
  // него в разметке вела бы в 404.
  const mediaRows = await sql<{ items: PublicImage[] }>`select app.illustrations_json(${id}, ${drafts}) as items`;
  const media = mediaRows[0]?.items ?? [];

  const documents = await sql<{body_json:unknown}>`
    select r.snapshot->'body_json' as body_json from app.entities e
    join app.revisions r on r.id=case when ${drafts} then e.working_revision_id else e.published_revision_id end
    where e.id=${id}`;
  const document = documents[0] ?? null;

  const linkRows = await sql<PublicCard["links"][number] & {justification_blocks:unknown}>`
    select other.id as other_id, other.slug as other_slug, other.title_ru as other_title,
           (app.entity_type_path(other.type_id) -> 0 ->> 'code') as other_root,
           lr.code as role, lr.title_ru as role_title,
           case when l.from_entity_id = ${id} then 'outgoing' else 'incoming' end as direction,
           (select r.snapshot->'body_json' from app.revisions r
            where r.id=case when ${drafts} then l.working_revision_id else l.published_revision_id end) as justification_blocks
      from app.read_links(${drafts}) l
      join app.read_entities(${drafts}) other
        on other.id = case when l.from_entity_id = ${id} then l.to_entity_id
                           else l.from_entity_id end
      left join app.link_roles lr on lr.id = l.role_id
     where (l.from_entity_id = ${id} or l.to_entity_id = ${id}) and (${drafts} or other.is_published)
       -- Иллюстрации и источники — тоже связи, но у каждых свой раздел.
       and coalesce(lr.code, '') not in ('illustration', 'source')
     order by l.is_primary desc, l.sort_order, l.id
  `;

  const links = linkRows.map(row => ({...row, justification:extractText(row.justification_blocks)}));

  // Где запись упоминается: текст и запись, которой он принадлежит (лекция).
  const mentions = await sql<PublicCard["mentions"][number]>`
    select distinct on (pm.document_id) pm.document_title,
           owner.slug as owner_slug, owner.title_ru as owner_title
      from app.published_entity_mentions pm
      left join app.read_entities(${drafts}) owner on owner.id = pm.owner_entity_id and owner.is_published
     where pm.entity_id = ${id}
     order by pm.document_id, owner.id nulls last
  `;

  const sourceRows = await sql<{ items: PublicCard["sources"] }>`select app.sources_json(${id}, ${drafts}) as items`;
  const sources = sourceRows[0]?.items ?? [];

  // Порядок разделов карточки задаёт тип (таблица отображений): ближайшая
  // настройка вверх по дереву.
  const layoutRows = await sql<{ component: string }>`
    select i.component
      from app.type_presentation_items i
     where i.presentation_id = app.presentation_for((select type_id from app.entities where id = ${id}), 'card')
     order by i.sort_order
  `;
  const layout = layoutRows.map((row) => row.component);
  const videoRows = await sql<{ cover: string | null }>`select app.video_cover(${id}, ${drafts}) as cover`;
  const video_cover = videoRows[0]?.cover ?? null;

  // Авторы материала — подписи карточки и её текста, без повторов. Тот же
  // расчёт, что в ответе клиенту: «как цитировать» везде одно.
  const authors = await entityAuthors(id);

  // Ссылки из текста — только на опубликованное; прочее остаётся словами.
  const refs = new Map<number, RefTarget>();
  const publicAssets = new Map<string, PublicImage>(media.map((m) => [m.asset_id, m]));
  if (document) {
    const ids = [...new Set(extractRefs(document.body_json).map((ref) => ref.entityId))];
    if (ids.length > 0) {
      const found = await sql<{ id: number; slug: string; title_ru: string; kind: string; compact: CompactItem[] }>`
        select e.id, e.slug, e.title_ru, ty.title_ru as kind,
               app.compact_json(e.id, ${drafts}) as compact
          from app.read_entities(${drafts}) e
          join app.entity_types ty on ty.id = e.type_id
         where e.id = any(${ids}::bigint[]) and (${drafts} or e.is_published)
      `;
      for (const row of found) {
        refs.set(Number(row.id), { slug: row.slug, title: row.title_ru, kind: row.kind, compact: row.compact });
      }
    }
    const assetIds = collectAssets(document.body_json);
    if (assetIds.length > 0) {
      const open = await sql<PublicImage>`
        select ma.id as asset_id, x.info->>'title' as caption,
               coalesce(x.info->>'author', x.info->>'credit') as author,
               coalesce(x.info->>'original_caption', x.info->>'holder') as source,
               x.info->>'source_url' as source_url
          from app.media_assets ma
          join app.entities img on img.id = ma.entity_id
          cross join lateral (select app.image_json(img.id, ${drafts}) as info) x
         where ma.id = any(${assetIds}::uuid[])
           and (${drafts} or img.status = 'published')
           and ma.archived_at is null
      `;
      for (const row of open) publicAssets.set(row.asset_id, row);
    }
  }

  return {
    is_published: Boolean(e.is_published),
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
    layout,
    video_cover,
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
            or m.document_id in (select d.id from app.documents d where d.owner_entity_id = ${entityId}))
       and mc.credit_role in ('author', 'coauthor')
     group by c.id, c.display_name
     order by min(case mc.credit_role when 'author' then 0 else 1 end), c.display_name
  `;
  return rows.map((r) => r.display_name);
}
