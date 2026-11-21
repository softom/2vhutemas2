import {useEffect,useState,useRef} from 'react';
import {request} from '../api';
import './ResearchAcceptance.css';
import {ResearchProposalForm} from './ResearchProposalForm';
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
 useEffect(()=>{const update=()=>{void refresh()};window.addEventListener('research-publication-updated',update);return()=>window.removeEventListener('research-publication-updated',update)},[entityId,setId,proposals,mapping]);
 const eligible=proposals.filter(p=>['create','append','append_batch'].includes(checks[p.id]?.action)).map(p=>p.id);
 async function accept(){if(!selected.length||checking||busy)return;setBusy(true);setError('');setNotice('');setConflict(null);try{
  const revision=await beforeStart();if(!revision)return;
  const choices=selections.filter(p=>selected.includes(p.id));
  const data=await request<any>(`/classification/${entityId}/accept`,{method:'POST',body:JSON.stringify({set_id:setId,base_revision_id:revision,selections:choices,expected:selected.map(id=>checks[id])})});
  onRevision(data.revision);setNotice(`Сохранено: ${data.items.filter((x:any)=>x.action!=='repeat').length}. Связи сохранены в черновики, без публикации.`);setSelected([]);window.dispatchEvent(new CustomEvent('research-updated'));await refresh();
 }catch(e){const id=(e as any).details?.proposal_id;if(id)setConflict({id,message:(e as Error).message});else setError((e as Error).message);await refresh();}finally{setBusy(false);}}
 const [draft,setDraft]=useState<{id:string;axis:string;title:string}|null>(null);
 async function createConcept(){
  if(!draft||busy||disabled||checking||!draft.title.trim())return;
  setBusy(true);setError('');setNotice('');
  try{
   const revision=await beforeStart();if(!revision)return;
   const saved=await request<any>(`/classification/${entityId}/accept`,{method:'POST',body:JSON.stringify({
    set_id:setId,base_revision_id:revision,selections:[{id:draft.id}],new_concept:{axis:draft.axis,title:draft.title}
   })});
   onRevision(saved.revision);setDraft(null);setNotice('Понятие опубликовано. Связь с цитатой сохранена в черновике.');
   window.dispatchEvent(new CustomEvent('research-updated'));
   setLibrary(await request('/classification/library'));
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 const locked=disabled||busy||checking;
 function candidateEditor(p:any){
  if(p.concept_id||!library)return null;
  if(draft?.id!==p.id)return <button type="button" className="ghost" disabled={locked} onClick={()=>setDraft({id:p.id,title:p.candidate_name||p.title,axis:p.axis})}>Создать понятие</button>;
  return <fieldset disabled={locked}><legend>Новое понятие библиотеки</legend>
   <label>Название<input maxLength={200} value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})}/></label>
   <label>Ось<select value={draft.axis} onChange={e=>setDraft({...draft,axis:e.target.value})}>{Object.entries(library.axes).map(([key,label])=><option key={key} value={key}>{String(label)}</option>)}</select></label>
   <button type="button" disabled={!draft.title.trim()} onClick={()=>void createConcept()}>Опубликовать понятие и сохранить связь в черновик</button>
   <button type="button" className="ghost" onClick={()=>setDraft(null)}>Отмена</button></fieldset>;
 }
 const rows=proposals.map(p=>{const source=sources.find(s=>s.source_uid===p.source_id),status=checks[p.id];return {id:p.id,candidateEditor:candidateEditor(p),title:(library?.axes[p.axis]||p.axis)+' · '+p.title,status:checking?'Проверяем…':status?.action==='duplicate'?'Повтор предложения выше':status?.action==='repeat'?(status.link_status==='published'&&status.published_revision_id===status.base_link_revision_id?(status.concept_published&&status.source_published?'Связь опубликована':'Связь опубликована, но понятие или источник остаётся черновиком'):status.published_revision_id?'Изменения сохранены в черновик связи; опубликована предыдущая версия':'Сохранено в черновик связи — не опубликовано'):status?.action==='append'?'Дополнит существующую связь':status?.action==='create'?'Новая связь':status?.error||'Не удалось проверить',eligible:eligible.includes(p.id),saved:status?.link_id?{id:status.link_id,status:status.link_status==='published'&&status.published_revision_id===status.base_link_revision_id?'Опубликованная версия связи':'Черновик связи — читателям не виден',text:status.before||''}:undefined,before:status?.before|| (status?.action==='repeat'?'Связь уже содержит это свидетельство':'Нет сохранённого свидетельства'),after:[roles[p.relation],p.title,p.phase,p.zone].filter(Boolean).join(' · '),quote:p.quote,rationale:p.rationale,sources:source?[{title:`№${sources.indexOf(source)+1} · ${source.source_title||source.source_url}`,url:source.source_url}]:[],error:conflict&&conflict.id===p.id?conflict.message:undefined,controls:!p.concept_id?[{label:'Понятие библиотеки',value:String(mapping[p.id]||''),options:[{value:'',label:'Выберите понятие'},...(library?.items||[]).filter((c:any)=>c.axis===p.axis).map((c:any)=>({value:String(c.id),label:c.title_ru}))],onChange:(v:string)=>{setMapping({...mapping,[p.id]:Number(v)});setSelected(selected.filter(id=>id!==p.id));}}]:[]};});
 return <><details><summary>Что проверяется?</summary><p>Сверяем понятие и ось со словарём, вид связи — с настройками набора, цитату — с сохранённым текстом источника. Затем ищем связь с тем же понятием, ролью, источником, фазой и частью объекта. Сравниваем цитату и обоснование. Смысл вывода оценивает редактор.</p></details><ResearchProposalForm view={{rows,selected,select:setSelected,save:()=>void accept(),busy:disabled||busy||checking,error,notice}}/></>;
}
