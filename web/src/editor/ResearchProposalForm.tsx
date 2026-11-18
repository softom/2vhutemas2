import type {ReactNode} from 'react';
import './ResearchAcceptance.css';
export type ProposalControl={label:string;value:string;options?:{value:string;label:string}[];onChange:(value:string)=>void};
export type ProposalRow={id:string;title:string;status:string;eligible:boolean;before:ReactNode;after:ReactNode;rationale?:string;quote?:string;sources?:{title:string;url:string}[];controls?:ProposalControl[];error?:string};
export type ProposalView={rows:ProposalRow[];selected:string[];select:(ids:string[])=>void;save:()=>void;busy:boolean;controls?:ProposalControl[];error?:string;notice?:string};
export function ResearchProposalForm({view}:{view:ProposalView}){
 const {rows,selected,busy}=view,eligible=rows.filter(r=>r.eligible).map(r=>r.id);
 const controls=(items:ProposalControl[]|undefined)=>items?.map((c,i)=><label key={i}>{c.label}{c.options?<select disabled={busy} value={c.value} onChange={e=>c.onChange(e.target.value)}>{c.options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>:<input disabled={busy} value={c.value} onChange={e=>c.onChange(e.target.value)}/>}</label>);
 return <section className="research-acceptance" aria-label="Предложения исследования"><h3>Предложения исследования</h3>
 <div className="research-controls">{controls(view.controls)}</div>
 <div className="research-selection"><button type="button" className="ghost" disabled={busy||!eligible.length} onClick={()=>view.select(eligible)}>Выделить все</button><button type="button" className="ghost" disabled={busy||!selected.length} onClick={()=>view.select([])}>Снять выделение</button><span>Выбрано {selected.length} из {eligible.length}</span></div>
 {rows.map(r=><article className="research-proposal" key={r.id}><input aria-label={'Выбрать: '+r.title} type="checkbox" disabled={busy||!r.eligible} checked={selected.includes(r.id)} onChange={e=>view.select(e.target.checked?[...selected,r.id]:selected.filter(id=>id!==r.id))}/><div className="research-proposal-body"><strong>{r.title}</strong><p role="status">{r.status}</p>{controls(r.controls)}<div className="research-comparison"><span><strong>Было</strong><div>{r.before}</div></span><span><strong>Будет</strong><div>{r.after}</div></span></div>{r.quote&&<blockquote>{r.quote}</blockquote>}{!!r.sources?.length&&<ul>{r.sources.map((s,i)=><li key={i}><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a><div className="hint">{s.url}</div></li>)}</ul>}{r.rationale&&<p><b>Обоснование: </b>{r.rationale}</p>}{r.error&&<p role="alert">{r.error}</p>}</div></article>)}
 <button type="button" disabled={busy||!selected.length} onClick={view.save}>Сохранить выбранное</button>{busy&&<p role="status">Проверяем и сохраняем…</p>}{view.error&&<p role="alert">{view.error}</p>}{view.notice&&<p role="status">{view.notice}</p>}
 </section>;
}
