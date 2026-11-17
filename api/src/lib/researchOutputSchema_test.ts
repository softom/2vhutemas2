import {researchOutputFormat} from './researchOutputSchema.ts';
Deno.test('Research response schema fixes table keys and allowed evidence IDs',()=>{
 const format=researchOutputFormat([{id:'parameter-uid',value_type:'table',columns:[{code:'style_name',value_type:'text'},{code:'style_reason',value_type:'text'}]}],['source-uid']);
 const proposal:any=format.json_schema.schema.properties.proposals.items;
 if(format.type!=='json_schema'||!format.json_schema.strict)throw new Error('Structured output required');
 if(proposal.properties.parameter_id.enum[0]!=='parameter-uid'||proposal.properties.source_ids.items.enum[0]!=='source-uid')throw new Error('UID constraints missing');
 const row=proposal.properties.value.items;
 if(row.type!=='object'||row.additionalProperties!==false||row.properties.style_name.type.includes('array'))throw new Error('Table row must have named typed cells');
 if(row.required.join(',')!=='style_name,style_reason')throw new Error('Column order/schema mismatch');
});
