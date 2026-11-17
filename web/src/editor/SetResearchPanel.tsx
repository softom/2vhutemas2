import {useEffect,useState,useRef,type ReactNode} from 'react';
import {request,type Indicator,type ParameterSetRow} from '../api';
type Data={sources:Record<string,string>[];state:any;revision:string|null};
export function SetResearchPanel({entityId,set,sets,beforeStart,onRevision,onAccept,children,actions}:{actions?:(disabled:boolean)=>ReactNode;children?:ReactNode;entityId:number;set:ParameterSetRow;sets:ParameterSetRow[];beforeStart:()=>Promise<string|undefined>;onRevision:(revision:string)=>void;onAccept:(group:Indicator)=>void}){
 const [data,setData]=useState<Data|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[chosen,setChosen]=useState<string[]>([]);
 const lastRevision=useRef<string|null>(null);
 const running=data?.state.status==='running';
 useEffect(()=>{const refresh=()=>request<Data>(`/set-research/${entityId}`).then(setData).catch(e=>setError(e.message));window.addEventListener('research-updated',refresh);return()=>window.removeEventListener('research-updated',refresh);},[entityId]);
 useEffect(()=>{if(data?.state.job)window.dispatchEvent(new CustomEvent('research-updated'));},[data?.state.job,data?.state.finished_at]);
 useEffect(()=>{let live=true;request<Data>(`/set-research/${entityId}`).then(v=>{if(live)setData(v);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[entityId]);
 useEffect(()=>{if(!running)return;let live=true;const timer=setInterval(()=>request<Data>(`/set-research/${entityId}?base=${lastRevision.current||''}`).then(v=>{if(live){setData(v);if(v.revision){lastRevision.current=v.revision;onRevision(v.revision);}else if(lastRevision.current&&v.state.status!=='running')setError('Исследование сохранено. Есть более свежая редакция карточки; перед дальнейшим сохранением перечитайте её. Введённые поля оставлены в форме.');}}).catch(e=>{if(live)setError(e.message);}),4000);return()=>{live=false;clearInterval(timer);};},[running,entityId]);
 async function start(action:string){
  if(busy||running)return;setBusy(true);setError('');setChosen([]);
  try{const revision=await beforeStart();if(!revision)return;
   const value=await request<Data>(`/set-research/${entityId}/${action}`,{method:'POST',body:JSON.stringify({set_id:set.id,base_revision_id:revision})});setData(value);if(value.revision){lastRevision.current=value.revision;onRevision(value.revision);}
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 const result=data?.state.results?.[set.id];
 function provenance(source:Record<string,string>){try{return JSON.parse(source.source_sets||'[]').map((id:string)=>sets.find(s=>s.id===id)?.title_ru||'Архивный набор').join(', ')||'Прежнее исследование';}catch{return 'Прежнее исследование';}}
 function accept(){
  const selected=(result?.proposals||[]).filter((p:any)=>chosen.includes(p.id));
  const values=selected.map((p:any)=>({parameter:p.parameter,title:p.title,value_type:p.type,note:p.rationale+'\n'+p.source_ids.map((id:string)=>data?.sources.find(s=>s.source_uid===id)?.source_url||id).join('\n'),
   ...(p.type==='table'?{rows:p.value}:p.type==='date'?{date_start_year:p.value.date_start_year,date_end_year:p.value.date_end_year??null,is_approximate:p.value.is_approximate===true}:p.type==='text'?{text_value:p.value}:p.type==='boolean'?{bool_value:p.value}:p.type==='option'?{option:p.option_code}: {num_value:p.value})}));
  onAccept({title:set.title_ru+' — исследование',is_current:true,values});setChosen([]);
 }
 return <div className="set-research-panel">
  <div className="row"><button type="button" className="ghost" disabled={busy||running} onClick={()=>void start('collect')}>Собрать источники</button><button type="button" className="ghost" disabled={busy||running||!data?.sources.length} onClick={()=>void start('analyze')}>Определить при помощи LLM</button>{actions?.(busy||running)}</div>
  {children}
  <p className="hint">Перед запуском сохраняется рабочая версия. Поиск учитывает тему набора; анализ использует общий корпус. Материалы доступны только редакторам.</p>
  {(error||data?.state.error)&&<p role="alert">{error||data?.state.error}</p>}
  {running&&<p role="status">{data?.state.action==='collect'?'Ищем источники и получаем тексты…':'Анализируем материалы…'} Можно вернуться позднее.</p>}
  {data?.state.warnings?.map((w:string,i:number)=><p className="hint" key={i}>{w}</p>)}
  {!!data?.sources.length&&<details><summary>Материалы исследования · {data.sources.length}</summary>{data.sources.map(s=><article key={s.source_uid}><a href={s.source_url} target="_blank" rel="noreferrer">{s.source_title||s.source_url}</a><p className="hint">{s.source_provider} · {s.source_status}</p><p className="hint">Собрано для: {provenance(s)}</p><p className="hint">Запросы: {s.source_queries||"—"}</p><details><summary>Текст источника</summary><pre style={{whiteSpace:'pre-wrap',maxHeight:300,overflow:'auto'}}>{s.source_text||s.source_excerpt}</pre></details></article>)}</details>}
  {result&&<details open><summary>Предложения для набора</summary>{result.proposals.map((p:any)=><label className="research-proposal" key={p.id}><input type="checkbox" checked={chosen.includes(p.id)} onChange={e=>setChosen(e.target.checked?[...chosen,p.id]:chosen.filter(id=>id!==p.id))}/><span><b>{p.title}</b>{Array.isArray(p.value)?p.value.map((row:Record<string,unknown>,index:number)=><dl key={index}>{Object.entries(row).map(([key,value])=><div key={key}><dt>{p.columns?.find((c:any)=>c.code===key)?.title||'Сведение'}</dt><dd>{String(value??'')}</dd></div>)}</dl>):<p>{p.type==='date'?String(p.value.date_start_year)+(p.value.date_end_year?'–'+p.value.date_end_year:''):p.type==='boolean'?(p.value?'Да':'Нет'):String(p.value)} {p.unit||''}</p>}<small>{p.rationale}</small></span></label>)}<button type="button" disabled={!chosen.length} onClick={accept}>Добавить выбранное в рабочую форму</button><p className="hint">Прежние значения сохраняются. Проверьте добавленную группу перед сохранением и публикацией.</p></details>}
 </div>;
}
