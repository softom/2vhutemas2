import { withConceptAttributes } from "./conceptAttributes.ts";
import type { PublicCard } from "./publicCard.ts";

type Link = PublicCard["links"][number];

/**
 * Идентификатор связи из драйвера приходит `bigint`. Без приведения типа
 * карта атрибутов не находит понятие — и виджет рисует запасной знак оси.
 */
Deno.test("concept attributes reach a link whose id came as bigint", () => {
  const link = { other_id: 1769n, other_title: "Модернизм" } as unknown as Link;
  const attributes = new Map<number, { color: string | null; icon: string | null }>([
    [1769, { color: "#2F5D8A", icon: "epoch_modernism" }],
  ]);
  const rows = withConceptAttributes([link], attributes);
  if (rows[0].concept_icon !== "epoch_modernism" || rows[0].concept_color !== "#2F5D8A") {
    throw Error("атрибуты понятия не приклеились к связи");
  }
});

Deno.test("a link without attributes keeps the axis fallback", () => {
  const link = { other_id: 99n, other_title: "Понятие без знака" } as unknown as Link;
  const attributes = new Map<number, { color: string | null; icon: string | null }>();
  const rows = withConceptAttributes([link], attributes);
  if (rows[0].concept_icon !== undefined || rows[0].concept_color !== undefined) {
    throw Error("у понятия без атрибутов появились знак или цвет");
  }
});
