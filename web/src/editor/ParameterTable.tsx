import {useEffect,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {api,request,type ParameterRow} from '../api';
import './ParameterTable.css';
type Source={source_uid:string;source_title:string;source_url:string};
const uidPattern=/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
function GrowingText({label,value,onChange}:{label:string;value:string;onChange:(value:string)=>void}){
 const ref=useRef<HTMLTextAreaElement>(null);
 useLayoutEffect(()=>{const el=ref.current;if(!el)return;const resize=()=>{if(el.clientWidth){el.style.height='auto';el.style.height=el.scrollHeight+2+'px';}};resize();let width=el.clientWidth;const observer=new ResizeObserver(()=>{if(el.clientWidth!==width){width=el.clientWidth;resize();}});observer.observe(el);return()=>observer.disconnect();},[value]);
 return <textarea ref={ref} aria-label={label} rows={2} value={value} onChange={e=>onChange(e.target.value)}/>;
}
function RowForm({title,initialOpen,children}:{title:string;initialOpen:boolean;children:ReactNode}){
 const [open,setOpen]=useState(initialOpen);
 return <details className="parameter-row-form" open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary>{title}</summary><div className="parameter-row-fields">{children}</div></details>;
}
function safeUrl(raw:string){try{const u=new URL(raw);return ['http:','https:'].includes(u.protocol)?u.href:null;}catch{return null;}}
function SourceField({label,value,sources,onChange}:{label:string;value:string;sources:Source[];onChange:(value:string)=>void}){
 const ids:string[]=value.match(uidPattern)||[];
 if(value.replace(uidPattern,'').replace(/[\s,;|\[\]"]/g,''))return <GrowingText label={label} value={value} onChange={onChange}/>;
 const choices=[...sources,...ids.filter(id=>!sources.some(s=>s.source_uid===id)).map(id=>({source_uid:id,source_title:'Недоступный источник',source_url:''}))];
 return <div className="parameter-source-field">{ids.length?<ul>{ids.map((id,i)=>{const s=sources.find(s=>s.source_uid===id),href=s&&safeUrl(s.source_url);return <li key={id+':'+i}>{href?<a href={href} target="_blank" rel="noreferrer">{s!.source_title||s!.source_url}</a>:s?.source_title||'Недоступный источник'}</li>;})}</ul>:<span className="hint">Источники не указаны</span>}<details><summary>Выбрать источники</summary>{choices.length?choices.map(s=><label className="checkbox" key={s.source_uid}><input type="checkbox" checked={ids.includes(s.source_uid)} onChange={e=>onChange((e.target.checked?[...ids,s.source_uid]:ids.filter(id=>id!==s.source_uid)).join(', '))}/>{s.source_title||s.source_url||'Недоступный источник'}</label>):<p className="hint">Сначала соберите источники.</p>}</details></div>;
}
export function ParameterTable({parameter,rows,onChange,entityId}:{parameter:string;rows:Record<string,unknown>[];onChange:(rows:Record<string,unknown>[])=>void;entityId?:number|null}){
 const [columns,setColumns]=useState<NonNullable<ParameterRow['columns']>>([]),[error,setError]=useState(''),[sources,setSources]=useState<Source[]>([]);
 const keys=useRef<string[]>([]);while(keys.current.length<rows.length)keys.current.push(crypto.randomUUID());keys.current.length=rows.length;
 useEffect(()=>{if(!entityId)return;let live=true;const refresh=()=>request<{sources:Source[]}>(`/set-research/${entityId}`).then(r=>{if(live)setSources(r.sources);}).catch(()=>{});void refresh();window.addEventListener('research-updated',refresh);return()=>{live=false;window.removeEventListener('research-updated',refresh);};},[entityId]);
 useEffect(()=>{api.parameters().then(r=>setColumns(r.items.find(p=>p.code===parameter)?.columns||[])).catch(e=>setError(e.message));},[parameter]);
 function change(index:number,key:string,value:unknown){onChange(rows.map((r,i)=>i===index?{...r,[key]:value}:r));}
 return <div className="parameter-row-forms">{error&&<p role="alert">{error}</p>}{rows.map((row,index)=>{
  const titleColumn=[...columns].sort((a,b)=>(a.summary_order??9999)-(b.summary_order??9999)).find(c=>c.value_type==='text'&&c.result_slot!=='source'&&typeof row[c.code]==='string'&&String(row[c.code]).trim());const title=titleColumn?String(row[titleColumn.code]).trim():'';
  const empty=!Object.values(row).some(v=>v!==null&&v!==undefined&&v!=='');
  return <RowForm key={keys.current[index]} initialOpen={empty} title={`${index+1}. ${title?title.slice(0,100)+(title.length>100?'…':''):empty?'Новая строка':'Строка'}`}>{columns.map(c=>{
   const value=row[c.code],label=c.title+(c.unit?', '+c.unit:''),option=typeof value==='object'&&value?String((value as any).code??''):String(value??'');const references=c.result_slot==='source'||typeof value==='string'&&(value.match(uidPattern)||[]).some(id=>sources.some(s=>s.source_uid===id))&&value.replace(uidPattern,'').replace(/[\s,;|\[\]"]/g,'')==='';
   return <div className="parameter-row-field" key={c.code}><div className="value-label">{label}</div>{c.value_type==='option'?<select aria-label={label} value={option} onChange={e=>change(index,c.code,e.target.value||null)}><option value="">Не указано</option>{option&&!c.options?.some(o=>o.code===option)&&<option value={option}>{typeof value==='object'&&value?String((value as any).title||option):option}</option>}{c.options?.map(o=><option key={o.code} value={o.code}>{o.title}</option>)}</select>:c.value_type==='boolean'?<label className="checkbox"><input aria-label={label} type="checkbox" checked={value===true} onChange={e=>change(index,c.code,e.target.checked)}/>Да</label>:['number','integer'].includes(c.value_type)?<input aria-label={label} type="number" step={c.value_type==='integer'?1:'any'} value={String(value??'')} onChange={e=>change(index,c.code,e.target.value===''?null:Number(e.target.value))}/>:references?<SourceField label={label} value={String(value??'')} sources={sources} onChange={v=>change(index,c.code,v)}/>:c.input_kind==='text'?<input aria-label={label} value={String(value??'')} onChange={e=>change(index,c.code,e.target.value)}/>:<GrowingText label={label} value={String(value??'')} onChange={v=>change(index,c.code,v)}/>}</div>;
  })}<button type="button" className="ghost" onClick={()=>{keys.current.splice(index,1);onChange(rows.filter((_,i)=>i!==index));}}>Убрать строку</button></RowForm>;
 })}<button type="button" className="ghost" disabled={!columns.length} onClick={()=>onChange([...rows,{}])}>＋ Добавить строку</button></div>;
}
