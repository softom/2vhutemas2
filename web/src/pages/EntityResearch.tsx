import { useEffect, useState } from 'react';
import { intake, type Dossier } from '../intake';
import { SketchResearch } from './SketchResearch';

export function EntityResearch({entityId,revision,onClose}:{entityId:number;revision:string;onClose:()=>void}) {
 const [d,setD]=useState<Dossier|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const running=d?.sketch?.research?.state==='running'&&Date.now()-Date.parse(d.sketch.research.started_at||'')<300000;
 useEffect(()=>{
  if(!running||!d)return;
  let live=true;
  const timer=setInterval(()=>intake.get(d.id).then(v=>{if(live)setD(v);}).catch(e=>{if(live)setError(e.message);}),4000);
  return()=>{live=false;clearInterval(timer);};
 },[running,d?.id]);
 async function start(replace:boolean){
  if(busy)return;setBusy(true);setError('');
  try{
   const current=d||await intake.fromEntity(entityId,revision);
   setD(current);
   // Reopening a saved result must not silently charge for another run.
   if(!d&&['ready','running'].includes(current.sketch?.research?.state||''))return;
   setD(await intake.research(current,replace));
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 async function select(ids:string[]){
  if(!d?.sketch||busy)return;setBusy(true);setError('');
  try{setD(await intake.saveSketch({...d,sketch:{...d.sketch,research_selected_ids:ids}}));}
  catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 return <div className="block" id="entity-research">
  <p>Исследуем последнюю сохранённую версию. Несохранённые правки редактора не входят в исследование и остаются в этой форме. Чтобы учесть их, сначала сохраните версию.</p>
  {error&&<p role="alert" className="error">{error}</p>}
  <SketchResearch value={d?.sketch?.research} disabled={busy} onStart={again=>void start(again)} onSelect={ids=>void select(ids)} readOnly={d?.status==='done'}/>
  {d&&<p><a href={'/entity-intake/'+d.id} target="_blank" rel="noopener noreferrer">Открыть эскиз для проверки и утверждения ↗</a>. Выбор предложений сохраняется в эскизе; текст карточки изменится только после утверждения.</p>}
  <button type="button" className="ghost" disabled={busy} onClick={onClose}>Скрыть исследование</button>
 </div>;
}
