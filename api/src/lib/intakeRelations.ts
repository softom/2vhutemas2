import { sql, type Tx } from "./db.ts";
import { ApiError } from "./errors.ts";
import { publishOwnerRevision } from "./ownedVersions.ts";
type Row=Record<string,any>;
const fail=(s:string):never=>{throw new ApiError('validation_failed',s);};
export async function relationOptions(){return {roles:await sql`select id,title_ru from app.link_roles where code in ('author','architect') order by sort_order`};}
export async function relationMatches(kind:string,q:string,tx:Tx=sql){
 if(!['author','place'].includes(kind))fail('Выберите автора или место');
 if(!q.trim())return [];
 return await tx<Row>`with recursive branch as (
 select id from app.entity_types where code=${kind==='place'?'place':'who'}
 union all select t.id from app.entity_types t join branch b on t.parent_id=b.id)
 select e.id,e.title_ru,e.title_original,e.working_revision_id,e.is_published from app.entities e
 where e.type_id in(select id from branch) and e.status <> 'archived'
 and (e.title_ru ilike '%'||${q.slice(0,300)}||'%' or e.title_original ilike '%'||${q.slice(0,300)}||'%')
 order by (lower(e.title_ru)=lower(${q})) desc,e.title_ru limit 12`;
}
export async function validateRelations(tx:Tx,input:unknown,old:Row[],sources:Row[],self:number|null){
 if(!Array.isArray(input)||input.length>30)fail('Не более 30 связей в эскизе');
 const result:Row[]=[],seen=new Set<string>();let places=0;
 for(const value of input as Row[]){
  if(value&&!value.kind&&!value.confirmed){result.push({...value,confirmed:false,entity_id:null});continue;}
  if(!value||!['author','place'].includes(value.kind))fail('Неверный вид связи');
  const candidate=value.candidate_intake_id||null;
  if(candidate && !old.some(r=>r.candidate_intake_id===candidate))fail('Кандидат должен быть создан из этого эскиза');
  const name=String(value.name||'').trim().slice(0,300),reason=String(value.reason||'').trim().slice(0,4000);
  const source_url=String(value.source_url||'').trim();
  const selected=value.entity_id==null||value.entity_id===''?null:Number(value.entity_id);
  if(selected!==null&&(!Number.isSafeInteger(selected)||selected<=0))fail('Неверный UID связанной сущности');
  const confirmed=value.confirmed===true;
  const role=value.kind==='author'?value.role_id||null:null;
  if(confirmed&&(!selected||!reason||!sources.some(s=>s.url===source_url)))fail('Подтвердите запись, обоснование и источник каждой связи');
  if(confirmed&&selected===self)fail('Нельзя связать сущность с самой собой');
  let revision=null,title='',published=false;
  if(selected){
   const rows=await tx<Row>`with recursive branch as (select id from app.entity_types where code=${value.kind==='place'?'place':'who'} union all select t.id from app.entity_types t join branch b on t.parent_id=b.id)
    select id,title_ru,working_revision_id,is_published from app.entities where id=${selected} and type_id in(select id from branch) and status <> 'archived' for share`;
   if(!rows.length)fail('Выбранная запись недоступна или имеет другой тип');
   title=rows[0].title_ru;published=rows[0].is_published;revision=rows[0].working_revision_id;
   if(confirmed&&!published)fail('Связь можно утвердить только с опубликованной записью');
  }
  if(role&&!(await tx`select id from app.link_roles where id::text=${String(role)} and code in ('author','architect')`).length)fail('Неизвестная роль автора');
  if(confirmed&&value.kind==='author'&&!role)fail('Выберите роль автора');
  const key=value.kind+':'+selected+':'+role;
  if(confirmed&&seen.has(key))fail('Одна связь выбрана дважды');if(confirmed)seen.add(key);
  if(confirmed&&value.kind==='place'&&++places>1)fail('Для адреса объекта выберите одно место');
  const prior=old.find(x=>x.kind===value.kind&&x.entity_id===selected&&x.role_id===role&&x.confirmed);
  result.push({manual:value.manual===true,candidate_intake_id:candidate,kind:value.kind,name,reason,source_url,entity_id:selected,role_id:role,confirmed,title,is_published:published,base_revision_id:confirmed&&prior?prior.base_revision_id:revision,matches:Array.isArray(value.matches)?value.matches.slice(0,12):[]});
 }
 return result;
}
function blocks(text:string,url:string):Row[]{return [{id:crypto.randomUUID(),type:'paragraph',content:[{type:'text',text,styles:{}}],children:[]},{id:crypto.randomUUID(),type:'paragraph',content:[{type:'link',href:url,content:[{type:'text',text:'Источник',styles:{}}]}],children:[]}];}
export async function applyRelations(tx:Tx,id:number,relations:Row[],actor:string,dossierId:string){
 if(relations.some(r=>r.candidate_intake_id&&!r.entity_id))fail('Сначала опубликуйте кандидата и обновите привязку, либо уберите предложение связи');
 const applied:Row[]=[];
 for(const r of relations.filter(r=>r.confirmed)){
  if(r.entity_id===id)fail('Нельзя связать сущность с самой собой');
  const current=await tx<Row>`select working_revision_id,is_published from app.entities where id=${r.entity_id} and status <> 'archived' for share`;
  if(!current.length||!current[0].is_published||current[0].working_revision_id!==r.base_revision_id)throw new ApiError('version_conflict','Связанная запись изменилась. Снимите подтверждение, сохраните и проверьте её заново');
  if(r.kind==='place'){
   const parameters=await tx<Row>`select id from app.parameters where code='address' and value_type='entity'`;
   if(!parameters.length)fail('Параметр адреса недоступен');
   const parameter=parameters[0].id;
   const existing=await tx<Row>`select v.entity_value_id from app.indicator_values v join app.indicators i on i.id=v.indicator_id where i.entity_id=${id} and v.parameter_id=${parameter}`;
   if(existing.some(v=>Number(v.entity_value_id)!==r.entity_id))throw new ApiError('version_conflict','У объекта уже указано другое место. Проверьте адрес в редакторе; прежнее значение сохранено');
   if(!existing.length){
    const group=await tx<Row>`insert into app.indicators(entity_id,title,is_current,note) values(${id},'Место',true,${r.reason+'\n'+r.source_url}) returning id`;
    await tx`insert into app.indicator_values(indicator_id,parameter_id,entity_value_id,note) values(${group[0].id},${parameter},${r.entity_id},${r.reason+'\n'+r.source_url})`;
   }
   applied.push({kind:'place',entity_id:r.entity_id,parameter_id:parameter,reused:!!existing.length});continue;
  }
  const existing=await tx<Row>`select id,status,published_revision_id from app.links where ((from_entity_id=${id} and to_entity_id=${r.entity_id}) or (from_entity_id=${r.entity_id} and to_entity_id=${id})) and role_id=${r.role_id} order by id`;
  if(existing.length){
   const live=existing.find(l=>l.status==='published'&&l.published_revision_id);
   if(!live)throw new ApiError('version_conflict','Такая связь уже есть в черновике или архиве. Проверьте её в редакторе связей');
   applied.push({kind:'author',entity_id:r.entity_id,link_id:live.id,reused:true});continue;
  }
  const l=await tx<Row>`insert into app.links(from_entity_id,to_entity_id,role_id,note) values(${id},${r.entity_id},${r.role_id},${r.reason}) returning id`;
  const m=await tx<Row>`insert into app.materials(kind,link_id,created_by) values('link',${l[0].id},${actor}) returning id`;
  await tx`insert into app.material_credits(material_id,contributor_id,credit_role) values(${m[0].id},${actor},'author')`;
  const revision=await tx<Row>`insert into app.revisions(material_id,edited_by,operation,summary,snapshot) values(${m[0].id},${actor},'create',${'Связь из эскиза '+dossierId},${JSON.stringify({body_json:blocks(r.reason,r.source_url)})}::jsonb) returning id`;
  await publishOwnerRevision(tx,{kind:'link',id:Number(l[0].id)},revision[0].id,actor,'Утверждена вместе с эскизом '+dossierId);
  applied.push({kind:'author',entity_id:r.entity_id,link_id:l[0].id,reused:false});
 }
 return applied;
}
