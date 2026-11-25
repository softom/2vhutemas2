/**
 * Общий слой чтения данных карточки (Р29–Р31).
 *
 * Здесь собирается то, что нужно нескольким виджетам и карточкам: подбор
 * «близких объектов», атрибуты понятий (цвет и знак) и год постройки.
 *
 * Три правила слоя:
 *  1. Фильтрация по записи идёт до разбора снимков версий, а не после:
 *     снимок читается только у тех записей, что прошли отбор.
 *  2. Типы ветви «Что» считаются один раз на запрос, а не для каждой строки.
 *  3. Повторные запросы и год постройки берутся из кэша процесса по ключу
 *     «запись + режим просмотра».
 *
 * Виджеты в базу не ходят: они получают готовые данные отсюда.
 */
import {sql} from './db.ts';
import {singleConstructionYear} from './attributionPhase.ts';

/** Пара «понятие + роль»: по ней ищутся общие атрибуции. */
export interface ConceptPair {
  concept_id: number;
  role_id: string;
}

/** Запись из подборки «близких объектов». */
export interface RelatedObject {
  id: number;
  slug: string;
  title: string;
  /** UID понятий, общих с исходной записью. */
  concepts: number[];
}

/** Атрибуты понятия: цвет и знак приходят из параметров записи. */
export interface ConceptAttributes {
  color: string | null;
  icon: string | null;
}

/** Коды параметров с атрибутами понятия (Д1). */
export const CONCEPT_ATTRIBUTE_CODES = ['concept_color', 'concept_icon'] as const;

/**
 * Кэш в памяти процесса (Р31). Ключ — запись и режим просмотра, срок жизни
 * короткий: опубликованное меняется редко, черновики — часто, поэтому у
 * черновиков срок меньше.
 */
const TTL_PUBLISHED_MS = 120_000;
const TTL_DRAFTS_MS = 10_000;
const CACHE_LIMIT = 500;

const cache = new Map<string, { at: number; value: unknown }>();

async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < ttlMs) return hit.value as T;
  const value = await load();
  cache.set(key, { at: now, value });
  if (cache.size > CACHE_LIMIT) {
    for (const [k, v] of cache) if (now - v.at >= ttlMs) cache.delete(k);
  }
  return value;
}

/** Сброс кэша слоя: нужен после правок данных в редакторе и в тестах. */
export function clearDataLayerCache(): void {
  cache.clear();
}

/**
 * Подбор «близких объектов» (Р29, Р30).
 *
 * Записи ветви «Что», у которых есть те же понятия с теми же ролями.
 * Порядок и отбор — по опубликованной версии записи, как в остальном
 * публичном выводе; в режиме черновиков — по рабочей версии.
 */
export async function readRelatedObjects(
  entityId: number,
  pairs: ConceptPair[],
  drafts: boolean,
): Promise<RelatedObject[]> {
  if (!pairs.length) return [];
  const concepts = pairs.map((p) => Number(p.concept_id));
  const roles = pairs.map((p) => String(p.role_id));
  const key = `related:${entityId}:${drafts ? 1 : 0}:${
    [...pairs].map((p) => `${Number(p.concept_id)}:${p.role_id}`).sort().join("|")
  }`;
  return cached(key, drafts ? TTL_DRAFTS_MS : TTL_PUBLISHED_MS, async () => {
    const rows = await sql<{ id: number; slug: string; title: string; concepts: number[] }>`
      with what_types as materialized (
        -- Ветвь «Что» считается один раз на запрос, а не для каждой строки (Р30).
        select app.entity_type_subtree('what') as id
      ), candidates as (
        select l.from_entity_id as obj_id, l.to_entity_id
          from app.links l
          join app.entities obj on obj.id = l.from_entity_id
         where l.status <> 'archived'
           and (${drafts} or (l.status = 'published' and obj.status = 'published' and obj.is_published))
           and obj.id <> ${entityId}
           and (l.to_entity_id, l.role_id) in
             (select * from unnest(${concepts}::bigint[], ${roles}::uuid[]))
      ), ranked as (
        select obj_id,
               array_agg(distinct to_entity_id) as concepts,
               count(distinct to_entity_id) as n
          from candidates
         group by obj_id
      ), titled as (
        -- Название, слаг и тип — из версии записи, которую видит спрашивающий.
        select r.obj_id, r.concepts, r.n, rev.type_id, rev.slug, rev.title
          from ranked r
          join app.entities e on e.id = r.obj_id
          cross join lateral (
            select (v.snapshot->'entity'->>'type_id')::uuid as type_id,
                   v.snapshot->'entity'->>'slug' as slug,
                   v.snapshot->'entity'->>'title_ru' as title
              from app.revisions v
             where v.id = case when ${drafts} then e.working_revision_id else e.published_revision_id end
          ) rev
      )
      select obj_id as id, slug, title, concepts
        from titled
       where type_id in (select id from what_types)
       order by n desc, title, obj_id
       limit 12
    `;
    return rows.map((row) => ({
      id: Number(row.id),
      slug: row.slug,
      title: row.title,
      concepts: (row.concepts ?? []).map(Number),
    }));
  });
}

/**
 * Атрибуты понятий (Д1): цвет и знак из текстовых параметров записи.
 * Пока параметров в базе нет, карта пуста — слой к этому готов.
 */
export async function readConceptAttributes(
  conceptIds: number[],
  drafts: boolean,
): Promise<Map<number, ConceptAttributes>> {
  const ids = [...new Set(conceptIds.map((id) => Number(id)))];
  if (!ids.length) return new Map();
  const key = `attributes:${drafts ? 1 : 0}:${ids.slice().sort((a, b) => a - b).join(",")}`;
  return cached(key, drafts ? TTL_DRAFTS_MS : TTL_PUBLISHED_MS, async () => {
    const rows = await sql<{ entity_id: number; code: string; value: string | null }>`
      select e.id as entity_id, p.code, v->>'text_value' as value
        from app.entities e
        join app.revisions r
          on r.id = case when ${drafts} then e.working_revision_id else e.published_revision_id end
        cross join lateral jsonb_array_elements(r.snapshot->'values') v
        join app.parameters p on p.id = (v->>'parameter_id')::uuid
       where e.id = any(${ids}::bigint[])
         and (${drafts} or e.status = 'published')
         and p.code in (${CONCEPT_ATTRIBUTE_CODES[0]}, ${CONCEPT_ATTRIBUTE_CODES[1]})
    `;
    const attributes = new Map<number, ConceptAttributes>();
    for (const id of ids) attributes.set(id, { color: null, icon: null });
    for (const row of rows) {
      const entry = attributes.get(Number(row.entity_id));
      if (!entry) continue;
      const value = row.value ? row.value.trim() : null;
      if (row.code === CONCEPT_ATTRIBUTE_CODES[0]) entry.color = value || null;
      if (row.code === CONCEPT_ATTRIBUTE_CODES[1]) entry.icon = value || null;
    }
    return attributes;
  });
}

/** Год постройки записи: тот же расчёт, что у виджета, но с кэшем (Р31). */
export async function readConstructionYear(entityId: number, drafts: boolean): Promise<string> {
  const key = `year:${entityId}:${drafts ? 1 : 0}`;
  return cached(key, drafts ? TTL_DRAFTS_MS : TTL_PUBLISHED_MS, async () =>
    await singleConstructionYear(sql, entityId, drafts)
  );
}
