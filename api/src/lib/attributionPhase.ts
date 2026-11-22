import type {Tx} from './db.ts';

// A bare base_year is redundant only for a building with a single documented period.
export async function singleConstructionYear(tx:Tx,id:number,drafts:boolean){
 const [row]=await tx<{base_year:string|null}>`with timeline as (
  select p.code,app.snapshot_value(${id},${drafts},p.id) v from app.parameters p
  where p.code in ('opening','construction_start','reconstruction')
 ), base as (
  select coalesce(max(v->>'date_start_year') filter(where code='opening'),
                  max(v->>'date_start_year') filter(where code='construction_start')) base_year from timeline
 )
 select base_year from base where base_year ~ '^[0-9]{4}$'
 and not exists(select 1 from timeline where code='reconstruction' and v is not null)
 and not exists(select 1 from app.links l join app.revisions r on r.id=case when ${drafts} then l.working_revision_id else l.published_revision_id end
 cross join lateral jsonb_path_query(r.snapshot->'body_json','$[*].content[*] ? (@.type == "sourceRef").props.phase') f
 where l.from_entity_id=${id} and l.status<>'archived' and trim(f#>>'{}') not in ('',base_year))`;
 return row?.base_year||'';
}
