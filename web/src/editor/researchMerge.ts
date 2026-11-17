import type {Indicator, IndicatorValue, SuggestedParameter} from '../api';

export const groupKey=(group:Indicator,index:number)=>group.id||`draft-${index}`;
export function groupLabel(group:Indicator,index:number) {
 const detail=group.values.find(v=>v.text_value)?.text_value;
 return `Группа ${index+1} — ${group.title||'Без названия'}${group.measured_year!=null?' · '+group.measured_year:''}${detail?' · '+detail.slice(0,70):''}`;
}
export const isMany=(field?:SuggestedParameter)=>field?.is_repeatable??['date','place'].includes(field?.value_type||'');
function canonical(value:unknown):string {
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])));
 return JSON.stringify(value)??'';
}
const valueIdentity=(v:IndicatorValue)=>canonical(Object.fromEntries(['text_value','num_value','bool_value','option','place_id','date_start_year','date_start_month','date_start_day','date_end_year','is_approximate','is_ongoing'].map(k=>[k,['is_approximate','is_ongoing'].includes(k)?(v as any)[k]===true:k==='num_value'&&v.num_value!=null?Number(v.num_value):(v as any)[k]??null])));

/** Same merge powers both preview and acceptance. Never mutates the source group. */
export function mergeResearchValues(current:IndicatorValue[],incoming:IndicatorValue[],fields:SuggestedParameter[]):IndicatorValue[] {
 let values=[...current];
 for(const next of incoming){
  const matches=values.filter(v=>v.parameter===next.parameter);
  if(next.rows){
   const old=matches[0];
   const known=new Set(matches.flatMap(v=>v.rows||[]).map(canonical));
   const added=next.rows.filter(row=>{const key=canonical(row);if(known.has(key))return false;known.add(key);return true;});
   if(old){if(added.length)values=values.map(v=>v===old?{...old,rows:[...(old.rows||[]),...added],note:[old.note,next.note].filter(Boolean).join('\n')}:v);}
   else values.push({...next,rows:added});
  }else if(isMany(fields.find(f=>f.parameter===next.parameter))){
   if(!matches.some(v=>valueIdentity(v)===valueIdentity(next)))values.push(next);
  }else{
   const at=values.findIndex(v=>v.parameter===next.parameter);
   values=values.filter(v=>v.parameter!==next.parameter);
   values.splice(at<0?values.length:at,0,next);
  }
 }
 return values;
}

export function proposalValue(p:any,sources:Record<string,string>[]):IndicatorValue {
 return {parameter:p.parameter,title:p.title,value_type:p.type,note:(p.rationale||'')+'\n'+(p.source_ids||[]).map((id:string)=>sources.find(s=>s.source_uid===id)?.source_url||id).join('\n'),
 ...(p.type==='table'?{rows:p.value}:p.type==='date'?{date_start_year:p.value.date_start_year,date_end_year:p.value.date_end_year??null,is_approximate:p.value.is_approximate===true}:p.type==='text'?{text_value:p.value}:p.type==='boolean'?{bool_value:p.value}:p.type==='option'?{option:p.option_code}:{num_value:p.value})};
}
