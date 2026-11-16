import { ApiError } from './errors.ts';

export interface ResearchSource { id:string; url:string; title:string; excerpt:string; provider:string; evidence:'snippet'|'provided'; }
export interface ResearchFinding { id:string; kind:'style'|'feature'; title:string; relation:'positive'|'negative'|'metaphor'; level:string; phase:string; zone:string; rationale:string; source_ids:string[]; entity_id:number|null; selected:boolean; }
export interface ResearchResult { state:'ready'; job:string; prepared_at:string; model:string; summary:string; consensus:'high'|'medium'|'split'|'unknown'; phases:{period:string;description:string;zones:string[]}[]; findings:ResearchFinding[]; sources:ResearchSource[]; warnings:string[]; }
const fail=():never=>{throw new ApiError('validation_failed','Некорректный результат исследования: проверьте источники и предложения');};
function text(v:unknown,max=4000):string {if(typeof v!=='string'||v.length>max)fail();return (v as string).trim();}
function list(v:unknown,max:number):any[]{if(!Array.isArray(v)||v.length>max)fail();return v as any[];}
export function researchUrl(v:unknown):string {const s=text(v);try{const u=new URL(s);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)fail();return u.href;}catch{return fail();}}
export function parseResearch(value:any,sources:ResearchSource[],catalog:{id:number;title_ru:string}[],job:string,model:string,warnings:string[]):ResearchResult {
 if(!value||typeof value!=='object')fail();
 const consensus=value.consensus;if(!['high','medium','split','unknown'].includes(consensus))fail();
 const phases=list(value.phases,20).map(p=>({period:text(p.period,200),description:text(p.description),zones:list(p.zones,10).map(z=>text(z,100))}));
 const findings=list(value.findings,60).map(f=>{
  if(!['style','feature'].includes(f.kind)||!['positive','negative','metaphor'].includes(f.relation))fail();
  const source_ids=[...new Set(list(f.source_ids,50).map(s=>text(s,100)))];
  if(!source_ids.length||source_ids.some(id=>!sources.some(s=>s.id===id)))fail();
  const entity_id=f.entity_id==null?null:Number(f.entity_id);
  if(entity_id!==null&&(!Number.isSafeInteger(entity_id)||!catalog.some(e=>e.id===entity_id)||f.kind!=='style'))fail();
  const title=text(f.title,300),rationale=text(f.rationale);if(!title||!rationale)fail();
  return {id:crypto.randomUUID(),kind:f.kind,title,relation:f.relation,level:text(f.level,100),phase:text(f.phase,200),zone:text(f.zone,200),rationale,source_ids,entity_id,selected:false} as ResearchFinding;
 });
 return {state:'ready',job,prepared_at:new Date().toISOString(),model,summary:text(value.summary,6000),consensus,phases,findings,sources,warnings};
}
// The client may select server-generated proposals, but cannot replace evidence or UID.
export function selectResearch(old:any,input:unknown):any {
 if(input===undefined)return old;
 if(!old||old.state!=='ready')fail();
 const ids=list(input,60).map(id=>text(id,100));
 if(new Set(ids).size!==ids.length||ids.some(id=>!old.findings.some((f:ResearchFinding)=>f.id===id)))fail();
 return {...old,findings:old.findings.map((f:ResearchFinding)=>({...f,selected:ids.includes(f.id)}))};
}
export function researchRunning(r:any):boolean{return r?.state==='running'&&Date.now()-Date.parse(r.started_at)<300000;}
export function researchParagraphs(r:any):any[] {
 if(r?.state!=='ready')return [];
 const findings=(r.findings as ResearchFinding[]).filter(f=>f.selected);if(!findings.length)return [];
 const paragraph=(content:any[])=>({id:crypto.randomUUID(),type:'paragraph',props:{},content,children:[]});
 const textNode=(text:string)=>({type:'text',text,styles:{}});
 const blocks=[paragraph([textNode('Исследование стиля и морфологии. '+r.summary)])];
 for(const f of findings){
  const relation={positive:'Атрибуция',negative:'Отрицание атрибуции',metaphor:'Метафора / цитата'}[f.relation];
  const context=[f.level,f.phase&&'фаза: '+f.phase,f.zone&&'зона: '+f.zone].filter(Boolean).join('; ');
  const content:any[]=[textNode(`${relation}: ${f.title}${context?' ('+context+')':''}. ${f.rationale}`)];
  if(f.entity_id)content.push(textNode(' '),{type:'link',href:'/entities/'+f.entity_id,content:[textNode('Запись каталога')]});
  blocks.push(paragraph(content));
  for(const sid of f.source_ids){const s=r.sources.find((s:ResearchSource)=>s.id===sid);if(!s)fail();blocks.push(paragraph([{type:'link',href:researchUrl(s.url),content:[textNode(s.title||s.url)]},textNode(s.evidence==='snippet'?' — поисковая выдержка; полный текст не проверен':' — материал досье')]));}
 }
 return blocks;
}
