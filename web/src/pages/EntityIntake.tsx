import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { intake, blankDossier, blankSource, type Dossier, type IntakeRow } from "../intake";
import { SketchRelations } from "./SketchRelations";
import { EntityIntakeDetails } from "./EntityIntakeDetails";

export function EntityIntake({allowed,canUpload,canPublish=false}:{allowed:boolean;canUpload:boolean;canPublish?:boolean}) {
 const {id}=useParams(),[params]=useSearchParams(),navigate=useNavigate();const story=params.get('story');
 const tab=['work','ready','done'].includes(params.get('tab')||'')?params.get('tab')!:'work';
 const filter=tab==='work'&&['proposed','reviewing','needs_info','rejected'].includes(params.get('filter')||'')?params.get('filter')!:tab;
 const [d,setD]=useState<Dossier|null>(null),[rows,setRows]=useState<IntakeRow[]>([]),[page,setPage]=useState(0),[total,setTotal]=useState(0);
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[dirty,setDirty]=useState(false),[confirm,setConfirm]=useState(false),[replace,setReplace]=useState(false),[advanced,setAdvanced]=useState(false);
 const [types,setTypes]=useState<{id:string;title_ru:string}[]>([]),[query,setQuery]=useState(''),[matches,setMatches]=useState<{id:number;title_ru:string}[]>([]);
 useEffect(()=>{if(!allowed)return;intake.types().then(r=>setTypes(r.items)).catch(e=>setError(e.message));},[allowed]);
 useEffect(()=>{if(!allowed)return;let live=true;setError('');setDirty(false);setConfirm(false);setAdvanced(false);setReplace(false);setD(null);
  if(id)(id==='new'?(story?intake.seed(story):Promise.resolve(blankDossier())):intake.get(id)).then(v=>{if(live)setD(v);}).catch(e=>{if(live)setError(e.message);});
  else intake.list('',filter,page).then(r=>{if(live){setRows(r.items);setTotal(r.total);}}).catch(e=>{if(live)setError(e.message);});
  return()=>{live=false;};
 },[allowed,id,story,filter,page]);
 const running=d?.sketch?.state==='running'&&Date.now()-Date.parse(d.sketch.started_at||'')<300000;
 useEffect(()=>{if(!running||!d)return;let live=true;const timer=setInterval(()=>intake.get(d.id).then(v=>{if(live)setD(v);}).catch(e=>{if(live)setError(e.message);}),4000);return()=>{live=false;clearInterval(timer);};},[running,d?.id]);
 useEffect(()=>{if(!dirty)return;const f=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',f);return()=>window.removeEventListener('beforeunload',f);},[dirty]);
 async function run(fn:()=>Promise<Dossier>){if(busy)return;setBusy(true);setError('');try{const v=await fn();setD(v);setDirty(false);setConfirm(false);if(id==='new')navigate('/entity-intake/'+v.id,{replace:true});}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
 function edit(p:Partial<Dossier>){if(d){setD({...d,...p});setDirty(true);setConfirm(false);}}
 function sketch(p:object){if(d?.sketch)edit({sketch:{...d.sketch,...p}});}
 const prepared=d?.sketch?.state==='ready',published=d?.status==='done';
 if(!allowed)return <p>Нужны права редактора.</p>;
 const active=id==='new'?'new':id?(published?'done':prepared?'ready':'work'):tab;
 const guard=(e:React.MouseEvent)=>{if(dirty||busy){e.preventDefault();setError('Сначала сохраните изменения в карточке.');return false;}setPage(0);return true;};
 const navigation=<>
  <nav className="robot-block-nav" aria-label="Разделы стека сущностей">
   {([['work','1','В работе'],['ready','2','Подготовленные'],['done','3','Опубликованные'],['new','+','Добавить']] as const).map(([value,number,title])=><Link key={value} to={value==='new'?'/entity-intake/new':'/entity-intake?tab='+value} className={active===value?'active':undefined} aria-current={active===value?'page':undefined} onClick={guard}><span className="robot-block-number">{number}</span><span>{title}</span></Link>)}
  </nav>
  <nav className="robot-tabs filters intake-submenu" aria-label="Подменю стека сущностей">
   {!id?(tab==='work'?([['work','Все в работе'],['proposed','Ожидают подготовки'],['reviewing','На проверке'],['needs_info','Нужно уточнение'],['rejected','Отложенные']] as const):([[tab,'Все '+(tab==='ready'?'подготовленные':'опубликованные')]] as const)).map(([value,title])=><Link key={value} to={'/entity-intake?tab='+tab+(value!==tab?'&filter='+value:'')} className={filter===value?'active':undefined} aria-current={filter===value?'page':undefined} onClick={guard}>{title}</Link>):<>
    <a href="#intake-card" className={!advanced?'active':undefined} aria-current={!advanced?'page':undefined} onClick={e=>{e.preventDefault();if(guard(e)){if(advanced&&id)void run(()=>intake.get(id));setAdvanced(false);}}}>{id==='new'?'Название и источники':published?'Карточка':'Эскиз'}</a>
    {id!=='new'&&<a href="#intake-details" className={advanced?'active':undefined} aria-current={advanced?'page':undefined} onClick={e=>{e.preventDefault();if(guard(e))setAdvanced(true);}}>Материалы и история</a>}
   </>}
  </nav>
 </>;
 return <section className="entity-intake"><h1>Стек сущностей</h1>{navigation}{error&&<p role="alert" className="error">{error}</p>}
 {advanced?<div id="intake-details"><EntityIntakeDetails allowed={allowed} canUpload={canUpload} embedded onDirtyChange={setDirty}/></div>:!id?<>
 <table><thead><tr><th>Название</th><th>Состояние</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td><Link to={'/entity-intake/'+r.id}>{r.title}</Link></td><td>{{proposed:'Ожидает подготовки',reviewing:'Подготовка / проверка',ready:'Эскиз готов',done:'Опубликовано',needs_info:'Нужно уточнение',rejected:'Отложено'}[r.status]}</td></tr>)}</tbody></table>{!rows.length&&<p>Пока пусто.</p>}<div className="filters"><button disabled={!page} onClick={()=>setPage(page-1)}>Назад</button><span>{page+1}</span><button disabled={(page+1)*30>=total} onClick={()=>setPage(page+1)}>Далее</button></div></>:!d?<p>Загрузка…</p>:<>
 <Link to={"/entity-intake?tab="+active} onClick={guard}>← К списку</Link>
 {published?<><h2>{d.sketch?.title||d.title}</h2><p>Опубликовано. <Link to={'/entities/'+d.target_entity_id+'/edit'}>Открыть карточку</Link></p></>:prepared&&d.sketch?<>
 <h2>Эскиз</h2><p>Проверьте описание и источники. До утверждения карточка не опубликована.</p>
 <fieldset disabled={busy}><label>Название<input value={d.sketch.title} onChange={e=>sketch({title:e.target.value})}/></label><label>Что это<select aria-label="Что это" value={d.sketch.type_id} onChange={e=>sketch({type_id:e.target.value})}>{types.map(t=><option key={t.id} value={t.id}>{t.title_ru}</option>)}</select></label><label>Описание<textarea aria-label="Описание" rows={14} value={d.sketch.description} onChange={e=>sketch({description:e.target.value})}/></label>
 {!!d.sketch.questions.length&&<div className="block"><b>Проверить перед публикацией</b><ul>{d.sketch.questions.map((q,i)=><li key={i}>{q}</li>)}</ul></div>}
 <h3>Источники</h3><ol>{d.sketch.sources.map((s,i)=><li key={i}><a href={s.url} target="_blank" rel="noreferrer">{s.title||s.url}</a><p>{s.description}</p></li>)}</ol>
 <SketchRelations value={d.sketch.related||[]} sources={d.sketch.sources} disabled={busy} onChange={related=>sketch({related})}/>
 {!!d.sketch.catalog_checks?.length&&<details><summary>Проверка специализированных каталогов</summary>{d.sketch.catalog_checks.map((c,i)=><p key={i}><b>{c.name}</b> — {{found:'Найдены источники',unavailable:'Недоступен',not_found:'Совпадения не найдены',not_checked:'Проверка не подтверждена'}[c.status]||c.status}. {c.note}</p>)}</details>}
 <details open={!!d.sketch.matches.length}><summary>Этот объект уже есть на сайте?</summary><p>Для существующего объекта описание будет добавлено к прежнему тексту.</p><button className="ghost" onClick={()=>sketch({target_entity_id:null})}>Создать новую сущность</button>{[...d.sketch.matches,...matches].filter((m,i,a)=>a.findIndex(x=>x.id===m.id)===i).map(m=><p key={m.id}><button className="ghost" onClick={()=>sketch({target_entity_id:m.id})}>{d.sketch?.target_entity_id===m.id?'✓ ':''}{m.title_ru}</button></p>)}<input aria-label="Поиск существующего объекта" value={query} onChange={e=>setQuery(e.target.value)}/><button onClick={()=>api.entities({q:query,limit:'10'}).then(r=>setMatches(r.items)).catch(e=>setError(e.message))}>Найти</button></details>
 <p>{d.sketch.target_entity_id?'Будет дополнена выбранная запись.':'Будет создана новая сущность.'}</p><button onClick={()=>void run(()=>intake.saveSketch(d))} disabled={!dirty}>Сохранить правки</button>
 <label><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)}/>Карточка и источники проверены</label><button disabled={!confirm||dirty||!canPublish||((!d.sketch.target_entity_id||d.sketch.related?.some(r=>r.confirmed&&r.kind==='author'))&&!canUpload)} onClick={()=>void run(()=>intake.approve(d))}>Утвердить и опубликовать</button>{dirty&&<p>Сначала сохраните правки.</p>}</fieldset>
 </>:<><h2>{id==='new'?'Добавить объект':d.title}</h2><fieldset disabled={busy||running}><label>Название объекта<input value={d.title} onChange={e=>edit({title:e.target.value})}/></label><label>Источники</label>{d.sources.map((s,i)=><div className="filters" key={s.id}><input style={{flex:1,minWidth:200}} type="url" aria-label={'Источник '+(i+1)} placeholder="https://…" value={s.url} onChange={e=>edit({sources:d.sources.map(x=>x.id===s.id?{...x,url:e.target.value}:x)})}/>{d.sources.length>1&&<button className="ghost" aria-label={'Убрать источник '+(i+1)} onClick={()=>edit({sources:d.sources.filter(x=>x.id!==s.id)})}>×</button>}</div>)}<button className="ghost" onClick={()=>edit({sources:[...d.sources,blankSource()]})}>+ Источник</button><p><button onClick={()=>void run(()=>intake.save(d))}>Сохранить в стек</button> <button onClick={()=>void run(async()=>{const saved=dirty||!d.version?await intake.save(d):d;return intake.prepare(saved,replace);})} disabled={!!d.sketch?.description&&!replace}>Подготовить эскиз</button></p>{d.sketch?.description&&<label><input type="checkbox" checked={replace} onChange={e=>setReplace(e.target.checked)}/>Подготовить заново; прежний эскиз останется в истории</label>}</fieldset>{running&&<p role="status">Изучаем источники и готовим карточку. Можно вернуться в стек.</p>}{d.sketch?.state==='error'&&<p role="alert">{d.sketch.error}</p>}</>}
 <details id="intake-card"><summary>Сохранённые материалы</summary><p>Сохранено источников: {d.sources.length}. Медиа: {d.sources.reduce((n,s)=>n+s.media.length,0)}.</p><button disabled={dirty||running} className="ghost" onClick={()=>setAdvanced(true)}>Открыть подробности</button></details>
 </>}
 </section>;
}
