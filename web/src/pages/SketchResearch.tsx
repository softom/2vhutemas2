import { useState } from 'react';
import type { Sketch } from '../intake';

export function SketchResearch({value,disabled,onStart,onSelect,readOnly=false}:{value:Sketch['research'];disabled:boolean;onStart:(replace:boolean)=>void;onSelect:(ids:string[])=>void;readOnly?:boolean}){
 const [replace,setReplace]=useState(false);
 const running=value?.state==='running'&&Date.now()-Date.parse(value.started_at||'')<300000;
 return <section className="block" aria-label="Исследование стиля"><h3>Исследование стиля и морфологии</h3>
 <p>Источники, строительные фазы, зоны здания, атрибуции и разногласия. Выбранные выводы добавятся в текст карточки при утверждении; справочники автоматически не создаются.</p>
 {!readOnly&&<>{value?.state==='ready'&&<label><input type="checkbox" checked={replace} onChange={e=>setReplace(e.target.checked)}/>Исследовать заново; предыдущий результат сохранится в истории</label>}<button disabled={disabled||running||(value?.state==='ready'&&!replace)} onClick={()=>{onStart(replace);setReplace(false);}}>{running?'Исследование выполняется…':'Исследовать стиль и морфологию'}</button></>}
 {running&&<p role="status">Ищем источники и готовим предложения. Можно вернуться к карточке позднее.</p>}
 {value?.state==='running'&&!running&&<p role="alert">Исследование прервано или превысило пять минут. Можно запустить повторно; материалы сохранены.</p>}
 {value?.error&&<p role="alert">{value.error}</p>}
 {value?.state==='ready'&&<><p>{value.summary}</p><p>Согласие источников: {{high:'высокое',medium:'частичное',split:'мнения расходятся',unknown:'не определено'}[value.consensus||'unknown']}.</p>
 {!!value.warnings?.length&&<ul>{value.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul>}
 {value.phases?.map((p,i)=><p key={i}><b>{p.period}</b> — {p.description} ({p.zones.join(', ')})</p>)}
 {value.findings?.map(f=><div key={f.id} style={{marginBlock:14,overflowWrap:'anywhere'}}><label><input type="checkbox" disabled={disabled||readOnly} checked={f.selected} onChange={e=>onSelect((value.findings||[]).filter(x=>x.id===f.id?e.target.checked:x.selected).map(x=>x.id))}/>{f.title}</label><p>{{positive:'Атрибуция',negative:'Отрицание атрибуции',metaphor:'Метафора / цитата'}[f.relation]} · {f.level} · {f.phase} · {f.zone}</p><p>{f.rationale}</p>{f.entity_id?<a href={'/entities/'+f.entity_id}>Запись каталога ↗</a>:<p>Предложение без привязки к записи каталога</p>}<ul>{f.source_ids.map(id=>{const s=value.sources?.find(s=>s.id===id);return s?<li key={id}><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a> — {s.evidence==='snippet'?'поисковая выдержка':'материал досье'}</li>:null;})}</ul></div>)}
 <details><summary>Материалы исследования ({value.sources?.length||0})</summary>{value.sources?.map(s=><div key={s.id} style={{overflowWrap:'anywhere'}}><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a><p>{s.provider} · {s.evidence==='snippet'?'Полный текст не проверен':'Предоставленный материал'}</p><p>{s.excerpt}</p></div>)}</details>
 </>}
 </section>;
}
