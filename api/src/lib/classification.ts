import {sql,type Tx} from './db.ts';
import {AXES} from './classificationValidation.ts';
export {AXES,RELATIONS,normalized,attributionProposal,attributionFormat,attributionFromFragment} from './classificationValidation.ts';
export async function classificationCatalog(tx:Tx=sql,drafts=true){
 const rows=await tx<any>`select e.id,e.title_ru,e.title_en,e.title_original,e.original_language,e.slug,e.is_published,t.code as axis,
 coalesce((select v.text_value from app.read_indicators(${drafts}) i join app.read_values(${drafts}) v on v.indicator_id=i.id join app.parameters p on p.id=v.parameter_id where i.entity_id=e.id and p.code='concept_definition' order by i.sort_order limit 1),'') as definition,
 coalesce((select app.table_rows_json(p.id,v.table_value) from app.read_indicators(${drafts}) i join app.read_values(${drafts}) v on v.indicator_id=i.id join app.parameters p on p.id=v.parameter_id where i.entity_id=e.id and p.code='concept_names' order by i.sort_order limit 1),'[]'::jsonb) as names
 from app.read_entities(${drafts}) e join app.entity_types t on t.id=e.type_id where t.code=any(${Object.keys(AXES)}::text[]) and (${drafts} or e.is_published) order by t.sort_order,e.id`;
 return rows.map(r=>({...r,id:Number(r.id)}));
}
