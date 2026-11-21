import { type Query, sql } from "./db.ts";

import type { CardSlot } from "./cardGrid.ts";

export interface CardLayout {
  id: string; page_id: string; revision: number; assigned: boolean; name: string; slots: CardSlot[];
}

export const CARD_PAGE_ID = "39ee9267-1a0e-4928-b608-24bf91f68101";

export async function readLayout(id: string, query: Query = sql) {
  const [row] = await query<{ layout: CardLayout }>`
    select to_jsonb(l) || jsonb_build_object('slots',coalesce((
      select jsonb_agg((to_jsonb(s) - 'call_entity_id') || jsonb_build_object('renderer_key',w.renderer_key)
                       order by s.sort_order)
      from app.page_layout s join app.widgets w on w.id=s.widget_id
      where s.layout_id=l.id), '[]'::jsonb)) as layout
    from app.layouts l where l.id=${id}`;
  return row?.layout ?? null;
}
export async function getPageLayout(pageId: string, query: Query = sql) {
  const [p] = await query<
    { current_layout_id: string | null }
  >`select current_layout_id from app.pages where id=${pageId}`;
  return p?.current_layout_id ? readLayout(p.current_layout_id, query) : null;
}
export async function getCardLayout(typeId: string, query: Query = sql) {
  const [match] = await query<{ layout_id: string }>`
    with recursive branch as (
      select id,parent_id,0 as depth from app.entity_types where id=${typeId}
      union all select t.id,t.parent_id,b.depth+1 from branch b join app.entity_types t on t.id=b.parent_id
    ) select p.layout_id from branch b join app.type_presentations p on p.type_id=b.id
      where p.mode='card' and p.layout_id is not null order by b.depth limit 1`;
  return match ? readLayout(match.layout_id, query) : getPageLayout(CARD_PAGE_ID, query);
}
