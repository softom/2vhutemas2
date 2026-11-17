import {useState} from 'react';
import type {Indicator,IndicatorValue,SuggestedParameter} from '../api';
import {groupKey,groupLabel,isMany,mergeResearchValues,proposalValue} from './researchMerge';
import './ResearchAcceptance.css';

export function ResearchAcceptance({title,proposals,sources,indicators,fields,onAccept,disabled}:{title:string;proposals:any[];sources:Record<string,string>[];indicators:Indicator[];fields:SuggestedParameter[];onAccept:(group:Indicator,target:string|null)=>void;disabled:boolean}){
 const groups=indicators.map((group,index)=>({group,index,key:groupKey(group,index)})).filter(({group})=>!group.values.length||group.values.some(v=>fields.some(f=>f.parameter===v.parameter)));
 const [target,setTarget]=useState(groups.length===1?groups[0].key:groups.length?'':'new');
 const [chosen,setChosen]=useState<string[]>([]),[notice,setNotice]=useState('');
 const [newTitle,setNewTitle]=useState(()=>{let n=1;while(indicators.some(g=>g.title===`${title} — исследование №${n}`))n++;return `${title} — исследование №${n}`;});
 const existing=groups.find(g=>g.key===target)?.group;
 const valid=target==='new'?!!newTitle.trim()&&!indicators.some(g=>g.title===newTitle.trim()):!!existing;
 const before=existing?.values||[];
 function display(v:IndicatorValue,p:any){
  if(v.rows)return <ol>{v.rows.map((row,i)=><li key={i}><dl>{Object.entries(row).map(([key,value])=><div key={key}><dt>{p.columns?.find((c:any)=>c.code===key)?.title||key}</dt><dd>{typeof value==='object'&&value?String((value as any).title??JSON.stringify(value)):String(value??'—')}</dd></div>)}</dl></li>)}</ol>;
  const field=fields.find(f=>f.parameter===v.parameter);
  return <span>{v.text_value??(v.bool_value!=null?(v.bool_value?'Да':'Нет'):v.option?(v.option_title||field?.options?.find(o=>o.code===v.option)?.title||v.option):v.date_start_year!=null?`${v.is_approximate?'около ':''}${v.date_start_year}${v.date_end_year!=null?'–'+v.date_end_year:''}`:v.num_value??'Не заполнено')}</span>;
 }
 function accept(){
  if(!valid||!chosen.length||disabled)return;
  const incoming=proposals.filter(p=>chosen.includes(p.id)).map(p=>proposalValue(p,sources));
  onAccept(existing?{...existing,values:mergeResearchValues(before,incoming,fields)}:{title:newTitle.trim(),is_current:true,values:mergeResearchValues([],incoming,fields)},existing?target:null);
  setChosen([]);setNotice(existing?'Выбранные изменения добавлены в группу. Сохраните версию карточки.':'Новая группа добавлена в форму. Сохраните версию карточки.');
 }
 return <details open className="research-acceptance"><summary>Предложения для набора</summary>
  <label>Куда добавить результаты<select value={target} disabled={disabled} onChange={e=>{setTarget(e.target.value);setChosen([]);setNotice('');}}><option value="">Выберите группу…</option>{groups.map(g=><option key={g.key} value={g.key}>Дополнить: {groupLabel(g.group,g.index)}</option>)}<option value="new">Создать новую группу</option></select></label>
  {target==='new'&&<label>Название новой группы<input value={newTitle} onChange={e=>setNewTitle(e.target.value)}/>{!valid&&<span className="hint">Укажите новое, отличающееся название.</span>}</label>}
  <p className="hint">Одиночное значение заменится только при выборе предложения. Строки таблиц и повторяемые значения добавятся к прежним. Остальные поля и группы сохранятся.</p>
  {proposals.map(p=>{
   const old=before.filter(v=>v.parameter===p.parameter);
   const incoming=proposals.filter(q=>q.id===p.id||(p.type==='table'||isMany(fields.find(f=>f.parameter===p.parameter)))&&chosen.includes(q.id)&&q.parameter===p.parameter).map(q=>proposalValue(q,sources));
   const after=mergeResearchValues(before,incoming,fields).filter(v=>v.parameter===p.parameter);
   return <label className="research-proposal" key={p.id}><input type="checkbox" disabled={!valid||disabled} checked={chosen.includes(p.id)} onChange={e=>setChosen(e.target.checked?[...chosen.filter(id=>p.type==='table'||isMany(fields.find(f=>f.parameter===p.parameter))||proposals.find(q=>q.id===id)?.parameter!==p.parameter),p.id]:chosen.filter(id=>id!==p.id))}/><span><b>{p.title}</b><span className="research-comparison"><span><strong>Было</strong>{target?'':<p>Сначала выберите группу.</p>}{target&&(old.length?old.map((v,i)=><div key={i}>{display(v,p)}</div>):<p>Не заполнено</p>)}</span><span><strong>Будет</strong>{after.map((v,i)=><div key={i}>{display(v,p)}</div>)}</span></span><small>{p.rationale}</small></span></label>;
  })}
  <button type="button" disabled={!valid||!chosen.length||disabled} onClick={accept}>Добавить выбранное в рабочую форму</button>
  {notice&&<p role="status">{notice}</p>}
 </details>;
}
