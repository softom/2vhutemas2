/**
 * Атрибуты понятия приклеиваются к связи: цвет и знак из данных (Д1).
 *
 * Модуль чистый: ни базы, ни виджета — только правило сопоставления. Его
 * можно проверить тестом без сервера.
 *
 * Идентификатор связи из драйвера приходит `bigint`, а карта атрибутов
 * ключуется числом. Без приведения типа поиск не находит атрибут — и виджет
 * рисует запасной знак оси вместо знака понятия.
 */
import type {ConceptAttributes} from './dataLayer.ts';
import type {PublicCard} from './publicCard.ts';

type Link = PublicCard['links'][number];

export function withConceptAttributes(links: Link[], attributes: Map<number, ConceptAttributes>): Link[] {
  return links.map(l => {
    const attribute = attributes.get(Number(l.other_id));
    return attribute ? { ...l, concept_color: attribute.color, concept_icon: attribute.icon } : l;
  });
}
