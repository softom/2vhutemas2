import {useEffect,useState,useRef,type ReactNode} from 'react';
import {request,type Indicator,type ParameterSetRow,type SuggestedParameter} from '../api';
import {AttributionAcceptance} from './AttributionAcceptance';
import {ResearchAcceptance} from './ResearchAcceptance';
type Data={sources:Record<string,string>[];state:any;revision:string|null};
export function SetResearchPanel({entityId,set,sets,beforeStart,onRevision,onAccept,children,actions,indicators,fields}:{actions?:(disabled:boolean)=>ReactNode;children?:ReactNode;entityId:number;set:ParameterSetRow;sets:ParameterSetRow[];beforeStart:()=>Promise<string|undefined>;onRevision:(revision:string)=>void;onAccept:(group:Indicator,target:string|null)=>Promise<boolean>;indicators:Indicator[];fields:SuggestedParameter[]}){
 const [data,setData]=useState<Data|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [taskId,setTaskId]=useState(set.research_tasks?.length===1?set.research_tasks[0].id:'');
 const [depth,setDepth]=useState<'min'|'medium'|'max'>('medium');
 const style=set.code==='style_solutions';
 const labels={min:'Минимум',medium:'Средний',max:'Максимум'};
 const [plan,setPlan]=useState<any>(null);
 useEffect(()=>{let live=true;setPlan(null);request(`/set-research/${entityId}/plan?set_id=${set.id}&task_id=${taskId}`).then(p=>{if(live)setPlan(p);}).catch(()=>{if(live)setPlan(null);});return()=>{live=false;};},[entityId,set.id,taskId,data?.state.finished_at]);
 const lastRevision=useRef<string|null>(null);
 const running=data?.state.status==='running';
 const [now,setNow]=useState(Date.now());
 useEffect(()=>{if(!running)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[running]);
 const progress=data?.state.progress;
 const elapsed=running&&data?.state.started_at?Math.max(0,Math.floor((now-Date.parse(data.state.started_at))/1000)):0;
 const ownJob=data?.state.set_id===set.id;
 const notices=[...new Set<string>(data?.state.warnings||[])];
 useEffect(()=>{const refresh=()=>request<Data>(`/set-research/${entityId}`).then(setData).catch(e=>setError(e.message));window.addEventListener('research-updated',refresh);return()=>window.removeEventListener('research-updated',refresh);},[entityId]);
 useEffect(()=>{if(data?.state.job)window.dispatchEvent(new CustomEvent('research-updated'));},[data?.state.job,data?.state.finished_at]);
 useEffect(()=>{let live=true;request<Data>(`/set-research/${entityId}`).then(v=>{if(live)setData(v);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[entityId]);
 useEffect(()=>{if(!running)return;let live=true;const timer=setInterval(()=>request<Data>(`/set-research/${entityId}?base=${lastRevision.current||''}`).then(v=>{if(live){setData(v);if(v.revision){lastRevision.current=v.revision;onRevision(v.revision);}else if(lastRevision.current&&v.state.status!=='running')setError('Исследование сохранено. Есть более свежая редакция карточки; перед дальнейшим сохранением перечитайте её. Введённые поля оставлены в форме.');}}).catch(e=>{if(live)setError(e.message);}),4000);return()=>{live=false;clearInterval(timer);};},[running,entityId]);
 async function start(action:string,mode=depth){
  if(busy||running)return;setBusy(true);setError('');
  try{const revision=await beforeStart();if(!revision)return;
   const value=await request<Data>(`/set-research/${entityId}/${action}`,{method:'POST',body:JSON.stringify({mode,set_id:set.id,task_id:taskId||undefined,base_revision_id:revision})});setData(value);if(value.revision){lastRevision.current=value.revision;onRevision(value.revision);}
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 const result=data?.state.results?.[set.id];
 function provenance(source:Record<string,string>){try{return JSON.parse(source.source_sets||'[]').map((id:string)=>sets.find(s=>s.id===id)?.title_ru||'Архивный набор').join(', ')||'Прежнее исследование';}catch{return 'Прежнее исследование';}}
 return <div className="set-research-panel">
  {(set.research_tasks?.length||0)>1&&<label>Задание исследования<select value={taskId} disabled={busy||running} onChange={e=>setTaskId(e.target.value)}><option value="">Выберите задание…</option>{set.research_tasks.map(t=><option key={t.id} value={t.id}>{t.title}</option>)}</select></label>}
  {style&&<fieldset disabled={busy||running}><legend>Глубина исследования</legend>
   {(Object.keys(labels) as (keyof typeof labels)[]).map(k=><label key={k}><input type="radio" checked={depth===k} onChange={()=>setDepth(k)}/>{labels[k]} {plan?.modes&&<>· {plan.modes[k].selected_chars.toLocaleString()} симв. · {plan.modes[k].coverage_pct}% · вызовов {plan.modes[k].estimated_calls}</>}</label>)}
   {plan?.modes&&<p>Источников найдено {plan.total_sources}, релевантных {plan.relevant_sources}. В них {plan.input_chars.toLocaleString()} символов. {plan.low_coverage_warning?plan.reason:`Рекомендуется режим «${labels[plan.recommended_mode as keyof typeof labels]}». ${plan.reason}`}</p>}
  </fieldset>}
  <div className="row"><button type="button" className="ghost" disabled={busy||running||!set.research_enabled||!taskId} onClick={()=>void start('collect')}>Собрать источники</button>{style&&<button type="button" className="ghost" disabled={busy||running||!set.research_enabled||!taskId||!data?.sources.length} onClick={()=>void start('collect','max')}>Доискать источники</button>}<button type="button" className="ghost" disabled={busy||running||!set.research_enabled||!taskId||!data?.sources.length||(style&&!plan?.modes?.[depth]?.estimated_calls)} onClick={()=>void start('analyze')}>Определить при помощи LLM</button><button type="button" className="ghost" disabled={busy||running||!result} onClick={()=>void start('clear')}>Очистить предложения LLM</button>{actions?.(busy||running)}</div>
  {plan&&!style&&<p className="hint">Следующий анализ: {plan.calls} запрос(а), максимум {plan.max_calls}; {plan.selected_chars.toLocaleString()} из {plan.input_chars.toLocaleString()} символов; источников {plan.analyzed_sources}, посторонних исключено {plan.excluded_unrelated}. Выбираются тематические фрагменты, полный корпус сохранён. Стоимость зависит от тарифа модели; автоматического полного прохода нет.</p>}
  <div className="research-progress" aria-live="polite" aria-atomic="true">
   {busy&&!running&&<p role="status">Сохраняем изменения…</p>}
   {running&&<><p role="status">{progress?.phase||(data?.state.action==='collect'?'Собираем источники':'Анализируем текст')}{progress?.total!=null?` · ${progress.done} из ${progress.total}`:''} · прошло {elapsed} с{!ownJob?' · выполняется для другого набора':''}</p><progress aria-label="Ход исследования" max={progress?.total||undefined} value={progress?.total?progress.done:undefined}/></>}
   {!running&&!busy&&ownJob&&data?.state.status==='ready'&&<p role="status">{data.state.action==='clear'?'Предложения LLM очищены.':data.state.action==='collect'?`Сбор завершён. Источников: ${data.sources.length}; текст страницы: ${data.sources.filter(s=>s.source_text).length}.`:result?.proposals.length?`Анализ завершён. Предложений: ${result.proposals.length}. Выберите нужные ниже.`:`Анализ завершён. Подходящих предложений нет.${result?.rejected?` Отклонено проверкой: ${result.rejected}.`:''}${result?.failed_parts?` Не обработано частей: ${result.failed_parts}.`:''}`}</p>}
   {(error||data?.state.error)&&<p role="alert">{error||data?.state.error}</p>}
   {!!notices.length&&<details open={!running&&!!ownJob&&!result?.proposals.length}><summary>Подробности исследования · {notices.length}</summary>{notices.map((w,i)=><p className="hint" key={i}>{w}</p>)}</details>}
  </div>
  {!!data?.state.log?.length&&<details className="research-log"><summary>Журнал исследования · {data.state.log.length}</summary><p className="hint">Задание: {data.state.job} · Запрос: {data.state.request_id}</p><ol style={{maxHeight:260,overflow:'auto',paddingLeft:24}}>{data.state.log.map((entry:{at:string;level:string;message:string},i:number)=><li key={i}><time dateTime={entry.at}>{new Date(entry.at).toLocaleTimeString('ru-RU')}</time> · {entry.level==='error'?'Ошибка: ':entry.level==='warning'?'Замечание: ':''}{entry.message}</li>)}</ol></details>}
  {set.result_kind==='relations'&&<p className="hint"><a href="/objects?type=architecture_classification" target="_blank" rel="noreferrer">Библиотека четырёх уровней</a> · Результаты исследования сохраняются как связи с источниками и цитатами.</p>}
  {children}
  <p className="hint">Перед запуском сохраняется рабочая версия. Поиск учитывает тему набора; анализ использует общий корпус. Материалы доступны только редакторам.</p>

  {!!data?.sources.length&&<details><summary>Материалы исследования · {data.sources.length}</summary>{data.sources.map((s,index)=><article key={s.source_uid}><a href={s.source_url} target="_blank" rel="noreferrer">№{index+1} · {s.source_title||s.source_url}</a><p className="hint">{s.source_url}</p><p className="hint">{s.source_provider} · {s.source_status}</p><p className="hint">{(()=>{try{const o=JSON.parse(s.source_observations||'[]').filter((x:any)=>x.kind==='retrieval').at(-1);return o?`Способ: ${o.method||'не получен'} · Язык: ${o.language||'не определён'} · ${o.quality==='page'?'текст страницы':o.quality==='partial'?'частичный текст':'только выдержка'}${o.chars?` · ${o.chars} знаков`: ""}`:'';}catch{return "";}})()}</p><p className="hint">Собрано для: {provenance(s)}</p><p className="hint">Запросы: {s.source_queries||"—"}</p><details><summary>Текст источника</summary><pre style={{whiteSpace:'pre-wrap',maxHeight:300,overflow:'auto'}}>{s.source_text||s.source_excerpt}</pre></details></article>)}</details>}
  {!!result?.proposals.length&&result.mode==='attributions'&&<AttributionAcceptance key={data?.state.job||'saved'} entityId={entityId} setId={set.id} proposals={result.proposals} sources={data?.sources||[]} beforeStart={beforeStart} onRevision={onRevision} disabled={!!running||busy}/>}
  {set.result_kind!=='relations'&&!!result?.proposals.length&&result.mode!=='attributions'&&<ResearchAcceptance key={data?.state.job||'saved'} title={set.title_ru} proposals={result.proposals} sources={data?.sources||[]} indicators={indicators} fields={fields} onAccept={onAccept} disabled={!!running||busy}/>}
 </div>;
}
