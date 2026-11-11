import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, type EntityListItem } from "../api";
import { intake, blankDossier, blankSource, INTAKE_STATUS, type Dossier, type IntakeSource, type IntakeMedia, type IntakeRow } from "../intake";

export function EntityIntakeDetails({allowed,canUpload,embedded=false,onDirtyChange}:{allowed:boolean;canUpload:boolean;embedded?:boolean;onDirtyChange?:(dirty:boolean)=>void}) {
 const {id}=useParams();const [params]=useSearchParams();const story=params.get("story");const navigate=useNavigate();
 const [rows,setRows]=useState<IntakeRow[]>([]),[total,setTotal]=useState(0),[page,setPage]=useState(0),[q,setQ]=useState(""),[status,setStatus]=useState("");
 const [d,setD]=useState<Dossier|null>(null),[dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const [match,setMatch]=useState(""),[matches,setMatches]=useState<EntityListItem[]>([]),[mergeQ,setMergeQ]=useState(""),[mergeRows,setMergeRows]=useState<IntakeRow[]>([]);
 useEffect(()=>{onDirtyChange?.(dirty);},[dirty,onDirtyChange]);
 const saving=useRef(false);
 const [historyVersion,setHistoryVersion]=useState<number|null>(null);
 useEffect(()=>{if(!allowed||id)return;let live=true;intake.list(q,status,page).then(r=>{if(live){setRows(r.items);setTotal(r.total);}}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[allowed,id,q,status,page]);
 useEffect(()=>{if(!allowed||!id){setD(null);return;}let live=true;setError("");setNotice("");setD(null);setDirty(false);setMatches([]);setMergeRows([]);
  const request=id==='new'?(story?intake.seed(story):Promise.resolve(blankDossier())):intake.get(id);
  request.then(v=>{if(live){setD(v);setDirty(id==='new');}}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};
 },[allowed,id,story]);
 useEffect(()=>{if(!dirty)return;const f=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue="";};window.addEventListener('beforeunload',f);return()=>window.removeEventListener('beforeunload',f);},[dirty]);
 if(!allowed)return <p className="error">Стек доступен редакторам.</p>;
 const change=(patch:Partial<Dossier>)=>{setD(v=>v?{...v,...patch}:v);setDirty(true);setNotice("");};
 const source=(sid:string,patch:Partial<IntakeSource>)=>{setD(v=>v?{...v,sources:v.sources.map(s=>s.id===sid?{...s,...patch}:s)}:v);setDirty(true);};
 const media=(sid:string,mid:string,patch:Partial<IntakeMedia>)=>{setD(v=>v?{...v,sources:v.sources.map(s=>s.id===sid?{...s,media:s.media.map(m=>m.id===mid?{...m,...patch}:m)}:s)}:v);setDirty(true);};
 const save=async()=>{if(!d||saving.current)return;saving.current=true;setBusy(true);setError("");try{const result=await intake.save(d);setD(result);setDirty(false);setNotice("Досье сохранено");if(id==='new')navigate('/entity-intake/'+result.id,{replace:true});}catch(e){setError((e as Error).message);}finally{setBusy(false);saving.current=false;}};
 const upload=async(sid:string,file:File)=>{setBusy(true);setError("");try{const form=new FormData();form.set('file',file);form.set('caption',file.name);const m=await api.uploadMedia(form);if(!m.entity_id)throw new Error('Не получен UID медиа');setD(v=>v?{...v,sources:v.sources.map(s=>s.id===sid?{...s,media:[...s.media,{id:crypto.randomUUID(),url:"",media_entity_id:m.entity_id!,kind:'image',caption:file.name,author:'',status:'stored',error:''}]}:s)}:v);setDirty(true);setNotice('Файл сохранён в медиатеке. Сохраните досье для закрепления источника.');}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 const merge=async(target:string)=>{if(!d)return;setBusy(true);setError("");try{const current=await intake.get(target);const sources=structuredClone(current.sources);for(const incoming of d.sources){const same=incoming.url?sources.find(s=>s.url===incoming.url):null;if(!same){sources.push(incoming);continue;}if(!same.description.includes(incoming.description))same.description+='\n\n'+incoming.description;for(const m of incoming.media)if(!same.media.some(old=>(m.url&&old.url===m.url)||(m.media_entity_id&&old.media_entity_id===m.media_entity_id)))same.media.push(m);}setD({...current,sources,status:'reviewing'});setDirty(true);setNotice('Материалы добавлены в существующее досье. Проверьте и сохраните.');setMergeRows([]);}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 return <section className="entity-intake">{embedded?<h2>Материалы и история</h2>:<h1>Стек сущностей для внесения в БД</h1>}
  <p className="hint">Досье с описаниями, источниками и медиа. Отбор в новости и пополнение каталога независимы.</p>
  {error&&<p className="error" role="alert">{error}</p>}{notice&&<p className="notice" role="status">{notice}</p>}
  {!id?<>
   <Link className="button" to="/entity-intake/new">Добавить досье</Link>
   <div className="filters"><label>Поиск<input value={q} onChange={e=>{setQ(e.target.value);setPage(0);}}/></label><label>Статус<select value={status} onChange={e=>{setStatus(e.target.value);setPage(0);}}><option value="">Все</option>{Object.entries(INTAKE_STATUS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label></div>
   <p>Досье: {total}</p><table className="grid-table"><thead><tr><th>Сущность</th><th>Статус</th><th>Источники / медиа</th><th>Обновлено</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td><Link to={'/entity-intake/'+r.id}>{r.title}</Link></td><td>{INTAKE_STATUS[r.status]}</td><td>{r.sources_count} / {r.media_count}</td><td>{new Date(r.updated_at).toLocaleString('ru-RU')}</td></tr>)}</tbody></table>
   <div className="filters"><button disabled={!page} onClick={()=>setPage(page-1)}>Предыдущие</button><span>Страница {page+1}</span><button disabled={(page+1)*30>=total} onClick={()=>setPage(page+1)}>Следующие</button></div>
  </>:!d?<p>Загрузка досье…</p>:<>
   <div className="filters"><button disabled={busy} onClick={()=>void save()}>Сохранить досье</button><button className="ghost" disabled={busy} onClick={()=>{setDirty(false);navigate('/entity-intake');}}>{dirty?'Закрыть без сохранения':'К списку'}</button><span>{dirty?'Есть несохранённые изменения':`Версия ${d.version}`}</span></div>
   <fieldset disabled={busy}><legend>Задание</legend><label>Название сущности<input value={d.title} onChange={e=>change({title:e.target.value})}/></label><label>Что внести: описание, авторы, типология, место, предлагаемые связи<textarea rows={5} value={d.description} onChange={e=>change({description:e.target.value})}/></label></fieldset>
   {id==='new'&&<details className="block"><summary>Добавить материалы к существующему досье</summary><input aria-label="Поиск досье для дополнения" value={mergeQ} onChange={e=>setMergeQ(e.target.value)}/><button disabled={busy} onClick={()=>intake.list(mergeQ).then(r=>setMergeRows(r.items)).catch(e=>setError(e.message))}>Найти досье</button>{mergeRows.map(r=><p key={r.id}><button disabled={busy} className="ghost" onClick={()=>void merge(r.id)}>{r.title} — {INTAKE_STATUS[r.status]}</button></p>)}</details>}
   <fieldset disabled={busy}><legend>Сопоставление с каталогом</legend><p>{d.target_entity_id?<>Связано с записью UID {d.target_entity_id}. <a target="_blank" rel="noreferrer" href={'/entities/'+d.target_entity_id+'/edit'}>Открыть редактор записи</a> <button className="ghost" onClick={()=>change({target_entity_id:null})}>Снять сопоставление</button></>:"Сущность ещё не сопоставлена."}</p>
   <label>Название для поиска<input value={match} onChange={e=>setMatch(e.target.value)}/></label><button type="button" onClick={()=>api.entities({q:match,limit:'10'}).then(r=>setMatches(r.items)).catch(e=>setError(e.message))}>Найти в каталоге</button>
   {matches.map(m=><p key={m.id}><button type="button" className="ghost" onClick={()=>{change({target_entity_id:m.id});setMatches([]);}}>{m.title_ru} · {m.type_title} · UID {m.id}</button></p>)}
   <p><a href="/entities/new" target="_blank" rel="noreferrer">Создать сущность в обычном редакторе</a> — затем найдите её здесь. Создание и публикация не выполняются автоматически.</p></fieldset>
   <h2>Источники и медиа ({d.sources.length})</h2>
   {d.sources.map((s,i)=><details className="block" key={s.id} open><summary>{i+1}. {s.title||'Новый источник'} · медиа {s.media.length}</summary><fieldset disabled={busy}><legend>Источник</legend>
    <label>Название источника<input value={s.title} onChange={e=>source(s.id,{title:e.target.value})}/></label><label>Ссылка на публикацию<input type="url" value={s.url} onChange={e=>source(s.id,{url:e.target.value})}/></label>
    {s.url&&<a href={/^https?:\/\//.test(s.url)?s.url:undefined} target="_blank" rel="noreferrer">Открыть источник</a>}
    <label>Описание и сведения из этого источника<textarea rows={5} value={s.description} onChange={e=>source(s.id,{description:e.target.value})}/></label>
    <div className="filters"><label>Издание<input value={s.publisher} onChange={e=>source(s.id,{publisher:e.target.value})}/></label><label>Автор публикации<input value={s.author} onChange={e=>source(s.id,{author:e.target.value})}/></label><label>Дата<input type="date" value={s.published_at||''} onChange={e=>source(s.id,{published_at:e.target.value||null})}/></label></div>
    {s.media.map(m=><div key={m.id} className="block"><b>Медиа · {m.media_entity_id?'Файл в медиатеке':m.status==='error'?'Ошибка получения':'Только ссылка'}</b>
     <label>Ссылка на медиа<input type="url" value={m.url} onChange={e=>media(s.id,m.id,{url:e.target.value})}/></label>{m.url&&<a href={/^https?:\/\//.test(m.url)?m.url:undefined} target="_blank" rel="noreferrer">Открыть медиа</a>}
     {m.media_entity_id&&<p><a href={'/entities/'+m.media_entity_id+'/edit'} target="_blank" rel="noreferrer">Медиатека · UID {m.media_entity_id}</a></p>}
     <label>Вид<select aria-label="Вид медиа" value={m.kind} onChange={e=>media(s.id,m.id,{kind:e.target.value})}>{['image','plan','drawing','video','document','other'].map(v=><option key={v} value={v}>{{image:'Изображение',plan:'План',drawing:'Чертёж',video:'Видео',document:'Документ',other:'Другое'}[v]}</option>)}</select></label>
     <label>Подпись<textarea aria-label="Подпись" rows={2} value={m.caption} onChange={e=>media(s.id,m.id,{caption:e.target.value})}/></label><label>Автор медиа<input value={m.author} onChange={e=>media(s.id,m.id,{author:e.target.value})}/></label>
     {!m.media_entity_id&&<><label>Получение<select aria-label="Получение медиа" value={m.status} onChange={e=>media(s.id,m.id,{status:e.target.value})}><option value="link">Обнаружена ссылка</option><option value="error">Ошибка получения</option></select></label>{m.status==='error'&&<label>Описание ошибки<input value={m.error} onChange={e=>media(s.id,m.id,{error:e.target.value})}/></label>}</>}
     <button type="button" className="ghost" onClick={()=>source(s.id,{media:s.media.filter(x=>x.id!==m.id)})}>Убрать из досье</button>
    </div>)}
    <button type="button" className="ghost" onClick={()=>source(s.id,{media:[...s.media,{id:crypto.randomUUID(),url:'',media_entity_id:null,kind:'image',caption:'',author:'',status:'link',error:''}]})}>Добавить ссылку на медиа</button>
    {canUpload&&<label>Загрузить файл в медиатеку<input type="file" onChange={e=>{const f=e.target.files?.[0];if(f)void upload(s.id,f);e.target.value='';}}/></label>}
    <p><button type="button" className="ghost" onClick={()=>change({sources:d.sources.filter(x=>x.id!==s.id)})}>Убрать источник из досье</button></p>
   </fieldset></details>)}
   <button disabled={busy} className="ghost" onClick={()=>change({sources:[...d.sources,blankSource()]})}>Добавить источник</button>
   <fieldset disabled={busy}><legend>Проверка и решение</legend><label>Статус<select aria-label="Статус" value={d.status} onChange={e=>change({status:e.target.value,confirm_done:false})}>{Object.entries(INTAKE_STATUS).map(([k,v])=><option key={k} value={k} disabled={d.version===0&&k!=='proposed'}>{v}</option>)}</select></label>
    <label>Причина решения / что внесено<textarea rows={3} value={d.reason} onChange={e=>change({reason:e.target.value})}/></label>
    {d.status==='done'&&<label><input type="checkbox" checked={!!d.confirm_done} onChange={e=>change({confirm_done:e.target.checked})}/>Проверено: материалы и связи внесены в выбранную запись каталога.</label>}
    <p className="hint">Сначала сохраните статус «Готово к внесению». После работы в редакторе записи проверьте результат и отметьте «Внесено».</p>
   </fieldset><button disabled={busy} onClick={()=>void save()}>Сохранить досье</button>
   {!!d.history?.length&&<details className="block"><summary>История изменений ({d.history.length})</summary>{d.history.map((h,i)=><details key={i} onToggle={e=>{if(e.currentTarget.open)setHistoryVersion(i);}}><summary>{new Date(h.at).toLocaleString('ru-RU')} · версия {h.snapshot.version} · {INTAKE_STATUS[h.snapshot.status]}</summary>{historyVersion===i&&<pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(h.snapshot,null,2)}</pre>}</details>)}</details>}
  </>}
 </section>;
}
