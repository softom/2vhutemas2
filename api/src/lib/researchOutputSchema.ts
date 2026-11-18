type Row=Record<string,any>;
/** Constrain both row shape and evidence IDs before generation; validate again after it. */
export function researchOutputFormat(parameters:Row[],sourceIds:string[],fragmentIds:number[]=[]){
 const variants=parameters.flatMap(p=>{
  let value:Row;
  if(['text','number','integer','boolean'].includes(p.value_type))value={type:p.value_type==='text'?'string':p.value_type};
  else if(p.value_type==='option'&&p.options?.length)value={type:'string',enum:p.options.map((o:Row)=>o.id)};
  else if(p.value_type==='date')value={type:'object',properties:{date_start_year:{type:'integer'},date_end_year:{type:['integer','null']}},required:['date_start_year','date_end_year'],additionalProperties:false};
  else if(p.value_type==='table'&&p.columns?.length){
   const properties:Row={};
   for(const c of p.columns){
    if(!['text','number','integer','boolean','option'].includes(c.value_type))return [];
    properties[c.code]=c.value_type==='option'?{type:['string','null'],enum:[...(c.options||[]).map((o:Row)=>o.code),null]}:{type:[c.value_type==='text'?'string':c.value_type,'null']};
   }
   value={type:'array',minItems:1,maxItems:100,items:{type:'object',properties,required:Object.keys(properties),additionalProperties:false}};
  }else return [];
  return [{type:'object',properties:{parameter_id:{type:'string',enum:[p.id]},value,fragment_id:{type:['integer','null'],enum:[...fragmentIds,null]},phase:{type:['string','null']},zone:{type:['string','null']},rationale:{type:'string'},source_ids:{type:'array',minItems:1,items:{type:'string',enum:sourceIds}}},required:['parameter_id','value','rationale','source_ids','fragment_id','phase','zone'],additionalProperties:false}];
 });
 if(!variants.length)throw new Error('В наборе нет параметров, поддерживаемых автоматическим заполнением');
 return {type:'json_schema',json_schema:{name:'parameter_set_research',strict:true,schema:{type:'object',properties:{proposals:{type:'array',maxItems:100,items:variants.length===1?variants[0]:{anyOf:variants}}},required:['proposals'],additionalProperties:false}}};
}
