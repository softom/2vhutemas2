/** Stage 3 data migration. Run on an explicitly named database with an authorized contributor UID. */
import { closePool, transaction } from "../src/lib/db.ts";
import { CARD_PAGE_ID } from "../src/lib/layouts.ts";
import { cardSectionNames } from "../src/lib/cardSections.ts";
import { widgetImplementations } from "../src/lib/widgetRegistry.ts";

type Extra = {kind:string;after?:string;cell:"main"|"side"|"full"};
type Entry = {key:string;column:number;width:number};
const [db, actor, action] = Deno.args;
if (!db || db!==Deno.env.get("APP_API_DB_NAME") || !actor || action!=="--prepare") {
  throw new Error("Usage: migrateCardLayouts.ts <APP_API_DB_NAME> <contributor UID> --prepare");
}
try {
const report=await transaction(actor,async q=>{
  const [role]=await q`select 1 from app.contributors c join app.user_roles ur on ur.contributor_id=c.id
    join app.role_permissions rp on rp.role_id=ur.role_id join app.permissions p on p.id=rp.permission_id
    where c.id=${actor} and c.status='active' and ur.revoked_at is null and p.action='su' limit 1`;
  if (!role) throw new Error("A contributor with su is required");
  await q`select pg_advisory_xact_lock(hashtextextended('card-layout-migration',0))`;
  const [page]=await q`select id from app.pages where id=${CARD_PAGE_ID} and current_layout_id is null for update`;
  if (!page) throw new Error("Expected the card page seeded by 0065 with an empty default");
  for (const [key,name] of Object.entries(cardSectionNames)) {
    await q`insert into app.widgets(name,renderer_key) values(${name},${key}) on conflict(renderer_key) do nothing`;
  }
  const catalog=new Map((await q<{id:string;renderer_key:string}>`select id,renderer_key from app.widgets`).map(w=>[w.renderer_key,w.id]));
  const types=await q<{id:string;type_id:string;code:string;layout_id:string|null;prepared:string|null;extras:Extra[]|null}>`
    select p.id,p.type_id,t.code,p.layout_id,p.settings->>'prepared_card_layout_id' prepared,p.settings->'card_widgets' extras from app.type_presentations p
    join app.entity_types t on t.id=p.type_id where mode='card' and not layout_only order by t.code for update of p`;
  const migrated=[];
  for (const type of types) {
    if(type.layout_id || type.prepared) {
      const id = type.layout_id ?? type.prepared;
      const [existing] = await q`select id,revision from app.layouts where id=${id} and page_id=${CARD_PAGE_ID}`;
      if (!existing) throw new Error(type.code + ": missing card layout " + id);
      migrated.push({type:type.code,type_id:type.type_id,layout:existing.id,revision:existing.revision,retained:true});
      continue;
    }
    const items=await q<{id:string;component:string;set_ids:string[]|null}>`select id,component,settings->'parameter_set_ids' set_ids
      from app.type_presentation_items where presentation_id=${type.id} order by sort_order,id for update`;
    const group=items.find(i=>i.component==="indicators");
    if (!group) throw new Error(type.code+": missing indicators; manual review required");
    // Candidate sets include inherited and individually attached definitions and sets whose
    // parameters occur in existing cards. Only values visible to the reader are rendered.
    const sets=await q<{id:string;code:string;card_side:string}>`
      with scope as (select t.id from app.entity_types t where app.presentation_for(t.id,'card')=${type.id}),
      records as (select e.id from app.entities e join scope s on s.id=e.type_id)
      select ps.id,ps.code,ps.card_side from app.parameter_sets ps where
        exists(select 1 from scope s join app.type_parameter_sets t on t.type_id in
          (select app.entity_type_ancestors(s.id)) where t.set_id=ps.id)
        or exists(select 1 from app.entity_parameter_sets es join records e on e.id=es.entity_id where es.set_id=ps.id)
        or exists(select 1 from records e join app.indicators i on i.entity_id=e.id
          join app.indicator_values v on v.indicator_id=i.id join app.parameter_set_items si on si.parameter_id=v.parameter_id where si.set_id=ps.id)
      order by ps.sort_order,ps.id`;
    const ids=group.set_ids??sets.map(s=>s.id);
    if(!Array.isArray(ids))throw new Error(type.code+": invalid parameter_set_ids");
    if(!group.set_ids)await q`update app.type_presentation_items set settings=jsonb_set(settings,'{parameter_set_ids}',${JSON.stringify(ids)}::jsonb) where id=${group.id}`;
    const extras=type.extras??[];
    if(!Array.isArray(extras))throw new Error(type.code+": invalid card_widgets");
    const entries:Entry[]=[];
    const pending=new Map<string,Entry[]>();
    const seen=new Set<string>();
    for(const x of extras){
      if(!x || !widgetImplementations.has(x.kind) || !catalog.has(x.kind) || !["main","side","full"].includes(x.cell)||seen.has(x.kind)) {
        throw new Error(type.code+": ambiguous card_widgets; migration rolled back");
      }
      seen.add(x.kind);
      const anchor=x.after==="parameter_sets"||x.after==="program"?"indicators":x.after??"";
      const list=pending.get(anchor)??[];list.push({key:x.kind,column:x.cell==="side"?3:1,width:x.cell==="side"?1:x.cell==="full"?3:2});pending.set(anchor,list);
    }
    for(const i of items){
      if(i.component==="program"||i.component==="parameter_sets")continue;
      const key=i.component==="indicators"?"parameters":i.component;
      if(!Object.hasOwn(cardSectionNames,key))throw new Error(type.code+": unsupported section "+key);
      entries.push({key,column:1,width:2});
      if(key==="parameters") entries.push({key,column:3,width:1});
      entries.push(...pending.get(i.component)??[]);pending.delete(i.component);
    }
    for(const list of pending.values())entries.push(...list);
    const [layout]=await q<{id:string}>`insert into app.layouts(page_id,name) values(${CARD_PAGE_ID},${"Карточка · "+type.code}) returning id`;
    let row=1,used=0,order=0;
    for(const entry of entries){
      const mask=((1<<entry.width)-1)<<(entry.column-1);
      if(used&mask){row++;used=0;}
      used|=mask;
      await q`insert into app.page_layout(layout_id,widget_id,sort_order,row_start,column_start,row_span,column_span)
        values(${layout.id},${catalog.get(entry.key)},${++order},${row},${entry.column},1,${entry.width})`;
    }
    // Keep the draft UID for retries. Only the assignment API changes layout_id.
    await q`update app.type_presentations set settings=jsonb_set(coalesce(settings,'{}'::jsonb),
      '{prepared_card_layout_id}',to_jsonb(${layout.id}::uuid)) where id=${type.id}`;
    migrated.push({type:type.code,type_id:type.type_id,layout:layout.id,revision:order,slots:order,sets:ids.length,parameters:["left","right"]});
  }
  return migrated;
});
console.log(JSON.stringify(report,null,2));
} finally { await closePool(); }
