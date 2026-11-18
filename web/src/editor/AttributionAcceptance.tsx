import {useEffect,useState,useRef} from 'react';
import {request} from '../api';
import './ResearchAcceptance.css';
import './AttributionAcceptance.css';
const roles:Record<string,string>={classification_membership:'Принадлежность',influence:'Влияние',classification_citation:'Цитирование приёма',classification_trait:'Наличие признака',classification_negation:'Отрицание'};
export function AttributionAcceptance({entityId,setId,proposals,sources,beforeStart,onRevision,disabled}:{entityId:number;setId:string;proposals:any[];sources:Record<string,string>[];beforeStart:()=>Promise<string|undefined>;onRevision:(id:string)=>void;disabled:boolean}){
 const [library,setLibrary]=useState<any>(null),[selected,setSelected]=useState<string[]>([]),[mapping,setMapping]=useState<Record<string,number>>({});
 const [checks,setChecks]=useState<Record<string,any>>({}),[checking,setChecking]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [conflict,setConflict]=useState<{id:string;message:string}|null>(null);
 const generation=useRef(0);
 useEffect(()=>{let live=true;request('/classification/library').then(x=>{if(live)setLibrary(x);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[]);
 const selections=proposals.map(p=>({id:p.id,concept_id:p.concept_id||mapping[p.id]||null}));
 async function refresh(){const current=++generation.current;setChecking(true);try{
  const data=selections.length?await request<any>(`/classification/${entityId}/check`,{method:'POST',body:JSON.stringify({set_id:setId,selections})}):{items:[]};
  if(current!==generation.current)return;
  const next=Object.fromEntries(data.items.map((x:any)=>[x.proposal_id,x]));setChecks(next);setSelected(ids=>ids.filter(id=>next[id]&&['create','append','append_batch'].includes(next[id].action)));
 }catch(e){if(current===generation.current){setChecks({});setError((e as Error).message);}}finally{if(current===generation.current)setChecking(false);}}
 useEffect(()=>{void refresh();return()=>{generation.current++;};},[entityId,setId,proposals,mapping]);
 const eligible=proposals.filter(p=>['create','append','append_batch'].includes(checks[p.id]?.action)).map(p=>p.id);
 async function accept(){if(!selected.length||checking||busy)return;setBusy(true);setError('');setNotice('');setConflict(null);try{
  const revision=await beforeStart();if(!revision)return;
  const choices=selections.filter(p=>selected.includes(p.id));
  const data=await request<any>(`/classification/${entityId}/accept`,{method:'POST',body:JSON.stringify({set_id:setId,base_revision_id:revision,selections:choices,expected:selected.map(id=>checks[id])})});
  onRevision(data.revision);setNotice(`Сохранено: ${data.items.filter((x:any)=>x.action!=='repeat').length}. Связи сохранены в рабочие версии, без публикации.`);setSelected([]);window.dispatchEvent(new CustomEvent('research-updated'));await refresh();
 }catch(e){const id=(e as any).details?.proposal_id;if(id)setConflict({id,message:(e as Error).message});else setError((e as Error).message);await refresh();}finally{setBusy(false);}}
 return <section className="research-acceptance classification-proposals" aria-label="Атрибуции по источникам">
 <h3>Связи с библиотекой понятий</h3>
 <p>Выберите нужные связи и сохраните. Цитата и обоснование сохранятся в версии связи.</p>
 {library&&<details><summary>Библиотека четырёх уровней · {library.items.length}</summary>{Object.entries(library.axes).map(([axis,title])=><div key={axis}><h4>{String(title)}</h4><ul>{library.items.filter((c:any)=>c.axis===axis).map((c:any)=><li key={c.id}><a href={`/entities/${c.id}/edit`} target="_blank" rel="noreferrer">{c.title_ru}</a>{c.title_en?` · ${c.title_en}`:''}{!c.is_published?' · черновик':''}</li>)}</ul></div>)}<a href="/objects?type=architecture_classification" target="_blank" rel="noreferrer">Открыть каталог понятий</a>{" · "}<button type="button" className="ghost" onClick={()=>{request('/classification/library').then(setLibrary).catch(e=>setError(e.message));}}>Обновить библиотеку</button></details>}
 <div className="classification-selection"><button type="button" disabled={disabled||busy||checking||!eligible.length} onClick={()=>{setSelected(eligible);}}>Выделить все</button><button type="button" disabled={disabled||busy||checking||!selected.length} onClick={()=>{setSelected([]);}}>Снять выделение</button><span>Выбрано {selected.length} из {eligible.length} доступных</span></div>
 {proposals.map(p=>{const source=sources.find(s=>s.source_uid===p.source_id),status=checks[p.id],valid=eligible.includes(p.id);return <article key={p.id} className="research-proposal"><input aria-label={`Выбрать: ${p.title}`} type="checkbox" checked={selected.includes(p.id)} disabled={disabled||busy||checking||!valid} onChange={e=>{setSelected(e.target.checked?[...selected,p.id]:selected.filter(id=>id!==p.id));}}/><div><p className="classification-title">{library?.axes[p.axis]||p.axis} · <strong>{p.title}</strong></p>
 {!p.concept_id&&<label>Кандидат: выберите существующее понятие<select disabled={busy} value={mapping[p.id]||''} onChange={e=>{setMapping({...mapping,[p.id]:Number(e.target.value)});setSelected(selected.filter(id=>id!==p.id));}}><option value="">Не сопоставлен</option>{library?.items.filter((c:any)=>c.axis===p.axis).map((c:any)=><option key={c.id} value={c.id}>{c.title_ru} · ID {c.id}</option>)}</select><a href={`/entities/new?type=${encodeURIComponent(p.axis)}`} target="_blank" rel="noreferrer">Создать понятие этой оси</a></label>}
 <p role="status"><strong>{checking?'Проверяем…':status?.action==='duplicate'?'Повтор предложения выше':status?.action==='repeat'?'Уже сохранено':status?.action==='append'?'Дополнит существующую связь':status?.action==='create'?'Новая связь':status?.error||'Не удалось проверить'}</strong></p>
 {conflict&&conflict.id===p.id&&<p role="alert">{conflict.message}</p>}
 {status?.action==='append'&&status.before&&<details><summary>Существующее обоснование</summary><p>{status.before}</p></details>}
 <p>{roles[p.relation]}{p.phase?` · Фаза: ${p.phase}`:''}{p.zone?` · Зона: ${p.zone}`:''}</p>
 <blockquote>{p.quote}</blockquote><p><a href={source?.source_url} target="_blank" rel="noreferrer">Источник №{sources.indexOf(source!)+1}: {source?.source_title||'Источник'}</a><span className="hint"> · {source?.source_url}</span>{p.locator?` · ${p.locator}`:''}</p><p><b>Обоснование: </b>{p.rationale}</p>
 {p.evidence!=='page'&&<p role="note">{p.evidence==='partial'?'Текст страницы получен частично.':'Только поисковая выдержка.'} Для принятия нужен полный сохранённый текст страницы с этой цитатой.</p>}
 </div></article>;})}
 <button type="button" disabled={disabled||busy||checking||!selected.length} onClick={()=>void accept()}>Сохранить выбранные связи</button>
 {busy&&<p role="status">Проверяем и сохраняем…</p>}{error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 </section>;
}
