import {sql,transaction,type Tx} from './db.ts';
import {AXES} from './classificationValidation.ts';
export {AXES,RELATIONS,normalized,attributionProposal,attributionFormat,attributionFromFragment} from './classificationValidation.ts';
import {ApiError} from './errors.ts';

export async function boundedCatalogRead<T>(tx:Tx, read:(run:Tx)=>Promise<T>):Promise<T>{
 if(tx===sql)return transaction(null,run=>boundedCatalogRead(run,read));
 const [slot]=await tx<{available:boolean}>`select pg_try_advisory_xact_lock(746221,1) or pg_try_advisory_xact_lock(746221,2) as available`;
 if(!slot.available)throw new ApiError('rate_limited','Два запроса каталога уже выполняются. Повторите позже.');
 const [prior]=await tx<{timeout:string}>`select current_setting('statement_timeout') as timeout`;
 await tx`set local statement_timeout='10s'`;
 const result=await read(tx);
 await tx`select set_config('statement_timeout',${prior.timeout},true)`;
 return result;
}

export async function classificationCatalog(tx:Tx=sql,drafts=true){
 return boundedCatalogRead(tx,async run=>{
  // Keep the full-library contract for matching and research. Enrich only selected IDs.
  const ids=await run<{id:string}>`select e.id from app.read_entities(${drafts}) e
   join app.entity_types t on t.id=e.type_id where t.code=any(${Object.keys(AXES)}::text[])
   and (${drafts} or e.is_published) order by t.sort_order,e.id`;
  const catalog=[];
  for(let offset=0;offset<ids.length;offset+=32){
   const page=ids.slice(offset,offset+32).map(row=>row.id);
   const rows=await run<any>`select e.id, r.snapshot->'entity'->>'title_ru' title_ru,
    r.snapshot->'entity'->>'title_en' title_en,r.snapshot->'entity'->>'title_original' title_original,
    r.snapshot->'entity'->>'original_language' original_language,r.snapshot->'entity'->>'slug' slug,
    e.is_published,t.code axis,coalesce(fields.definition,'') definition,coalesce(fields.names,'[]'::jsonb) names
    from unnest(${page}::bigint[]) with ordinality page(id,ord)
    join app.entities e on e.id=page.id join app.revisions r on r.id=case when ${drafts} then e.working_revision_id else e.published_revision_id end
    join app.entity_types t on t.id=(r.snapshot->'entity'->>'type_id')::uuid
    left join lateral (select max(val->>'text_value') filter(where code='concept_definition') definition,
      (jsonb_agg(app.table_rows_json(pid,app.public_value(val)->'table_value')) filter(where code='concept_names'))->0 names
      from (select distinct on(p.code) p.code,p.id pid,v.val
       from jsonb_array_elements(r.snapshot->'values') v(val)
       join app.parameters p on p.id=(v.val->>'parameter_id')::uuid and p.is_published
       join jsonb_array_elements(r.snapshot->'indicators') i(val) on i.val->>'id'=v.val->>'indicator_id'
       where p.code in ('concept_definition','concept_names')
       order by p.code,(i.val->>'sort_order')::int,(v.val->>'sort_order')::int) selected) fields on true
    where (${drafts} or e.status='published') and t.code=any(${Object.keys(AXES)}::text[]) order by page.ord`;
   catalog.push(...rows.map(r=>({...r,id:Number(r.id)})));
  }
  return catalog;
 });
}
