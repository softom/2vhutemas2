import {normalizeZone} from './attributionZones.ts';
import {readConceptAttributes, readConstructionYear, readRelatedObjects} from './dataLayer.ts';
import {withConceptAttributes} from './conceptAttributes.ts';
import {styleAttributionWidgetHtml} from './styleAttributionWidget.ts';
import {sql} from './db.ts';
import {escapeHtml,entityPath} from './site.ts';
import type {PublicCard} from './publicCard.ts';
type Link=PublicCard['links'][number];
export interface PublicRelationSet {id:string;code:string;title:string;side:'left'|'right';fields:{slot:string;title:string}[];links:Link[];similar?:{id:number;slug:string;title:string;concepts:number[]}[]}
/** Definitions select existing visible links by UID; no research corpus or proposals enter the public card. */
export async function loadPublicRelationSets(entityId:number,links:Link[],drafts=false):Promise<PublicRelationSet[]>{
 const sets=await sql<any>`select ps.id,ps.code,ps.title_ru as title,ps.card_side as side,
  (select jsonb_agg(jsonb_build_object('slot',i.result_slot,'title',coalesce(i.label_override,p.title_ru)) order by i.sort_order,p.sort_order,p.id)
   from app.parameter_set_items i join app.parameters p on p.id=i.parameter_id where i.set_id=ps.id and i.result_slot is not null) as fields,
  (select jsonb_agg(type_id) from app.parameter_set_allowed_types where set_id=ps.id) as types,
  (select jsonb_agg(role_id) from app.parameter_set_allowed_roles where set_id=ps.id) as roles
 from app.parameter_sets ps where ps.result_kind='relations' and
  (exists(select 1 from app.entity_parameter_sets eps where eps.entity_id=${entityId} and eps.set_id=ps.id)
   or exists(select 1 from app.type_parameter_sets tps where tps.set_id=ps.id and tps.type_id in
    (select app.entity_type_ancestors((select type_id from app.entities where id=${entityId})))))
 order by ps.sort_order,ps.id`;
 const attached: PublicRelationSet[] = sets.map((s:any)=>({...s,fields:s.fields||[],links:links.filter(l=>l.direction==='outgoing'&&(s.types||[]).map(String).includes(String(l.other_type_id))&&(s.roles||[]).map(String).includes(String(l.role_id)))}));
 const style = attached.find(set => set.code === 'style_solutions');
 if (style) {
   style.links=style.links.map(l=>({...l,citations:l.citations.map(c=>({...c,zone:normalizeZone(c.zone)}))}));
   if(style.links.some(l=>l.citations.some(c=>/^\d{4}$/.test(c.phase||'')))){
    const year=await readConstructionYear(entityId,drafts);
    if(year)style.links=style.links.map(l=>({...l,citations:l.citations.map(c=>c.phase===year?{...c,phase:''}:c)}));
   }
   const comparable = style.links.filter(link => link.role_id && link.role !== 'classification_negation');
   if (comparable.length) {
     // Подбор — общий слой чтения (Р29): здесь только данные виджета.
     style.similar = await readRelatedObjects(entityId, comparable.map(l=>({concept_id:l.other_id,role_id:l.role_id!})), drafts);
   }
   // Атрибуты понятий (цвет и знак) — общий слой (Д1).
   const attributes = await readConceptAttributes(style.links.map(l=>l.other_id), drafts);
   style.links = withConceptAttributes(style.links, attributes);
 }
 return attached;
}
/** Same presentation for every relation-valued parameter set; labels/order/side come from its definition. */
export function relationSetsHtml(sets:PublicRelationSet[],side:'left'|'right'):string{
 const e=escapeHtml;
 return sets.filter(s=>s.side===side).map(s=>s.code==='style_solutions'?styleAttributionWidgetHtml(s):`<section class="parameter-set-relations" data-parameter-set="${e(s.id)}"><h2>${e(s.title)}</h2>${s.links.length?'':'<p class="hint">Опубликованных связей пока нет.</p>'}${s.links.map(l=>{
  const values:Record<string,string>={concept:`<a href="${e(entityPath(l.other_slug))}">${e(l.other_title)}</a>`,relation:e(l.role_title||''),rationale:e(l.justification||''),
   quote:l.citations.map(q=>q.quote?`<blockquote><p>${e(q.quote)}</p><footer><a href="${e(entityPath(q.source_slug))}">${e(q.source_title)}</a></footer></blockquote>`:'').join(''),
   source:[...new Map(l.citations.map(q=>[q.source_entity_id,`<a href="${e(entityPath(q.source_slug))}">${e(q.source_title)}</a>`])).values()].join('<br>'),
   phase:e([...new Set(l.citations.map(q=>q.phase).filter(Boolean))].join('; ')),zone:e([...new Set(l.citations.map(q=>q.zone).filter(Boolean))].join('; '))};
  return `<details class="parameter-set-relation" data-relation-id="${e(String(l.id))}"><summary><strong>${e(l.other_title)}</strong>${l.role_title?` — ${e(l.role_title)}`:''}</summary><dl>${s.fields.filter(f=>values[f.slot]).map(f=>`<dt>${e(f.title)}</dt><dd>${values[f.slot]}</dd>`).join('')}</dl></details>`;
 }).join('')}</section>`).join('');
}
