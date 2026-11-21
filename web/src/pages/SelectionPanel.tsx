import { useEffect, useState } from "react";
import { ApiError, request } from "../api";
import type { Layout } from "./PageEditor";

export const sectionSources:Record<string,string>={
  "39ee9267-1a0e-4928-b608-24bf91f68102":"00000000-0000-4000-a000-0000000000e2",
  "39ee9267-1a0e-4928-b608-24bf91f68103":"00000000-0000-4000-a000-0000000000e1",
};
export type Selection={
  source_type_id:string|null;filter_type_id:string|null;filter_text:string|null;
  repeat_mode:"block"|"journal"|null;first_slot_id:string|null;last_slot_id:string|null;
};
type Type={id:string;parent_id:string|null;name:string};
type Preview={items:{slot_id:string;entity_id:string;repeat:number}[]};

function selection(l:Layout):Selection{
  const {source_type_id,filter_type_id,filter_text,repeat_mode,first_slot_id,last_slot_id}=l;
  return {source_type_id,filter_type_id,filter_text,repeat_mode,first_slot_id,last_slot_id};
}
export function SelectionPanel({layout,types,root,busy,onBusy,onSave,onMarks}:{
  layout:Layout;types:Type[];root:string;busy:boolean;onBusy:(v:boolean)=>void;onSave:(l:Layout)=>void;
  onMarks:(m:{layoutId:string;first:string;last:string})=>void;
}){
  const [form,setForm]=useState(()=>selection(layout));
  const [latest,setLatest]=useState<Layout|null>(null);
  const [notice,setNotice]=useState("");
  const [preview,setPreview]=useState<Preview|null>(null);
  const [previewError,setPreviewError]=useState("");
  const slots=layout.slots;
  const branch=types.filter(t=>{
    const seen=new Set<string>();
    let id:string|null=t.id;
    while(id && !seen.has(id)){if(id===root)return true;seen.add(id);id=types.find(x=>x.id===id)?.parent_id ?? null;}
    return false;
  });
  useEffect(()=>{onMarks({layoutId:layout.id,first:form.first_slot_id ?? "",last:form.last_slot_id ?? ""});},[layout.id,form.first_slot_id,form.last_slot_id,onMarks]);
  useEffect(()=>{
    const ctrl=new AbortController();setPreview(null);setPreviewError("");
    if(layout.repeat_mode)request<Preview>("/admin/layouts/"+layout.id+"/selection-preview",{signal:ctrl.signal})
      .then(p=>{if(!ctrl.signal.aborted)setPreview(p);}).catch(e=>{if(!ctrl.signal.aborted)setPreviewError(e.message);});
    return ()=>ctrl.abort();
  },[layout.id,layout.revision,layout.repeat_mode]);
  const slotName=(id:string|null,l=layout)=>{const s=l.slots.find(x=>x.id===id);return s?s.sort_order+". "+s.widget_name:"—";};
  function change(p:Partial<Selection>){setForm({...form,...p});setNotice("");}
  const start=slots.findIndex(x=>x.id===form.first_slot_id),end=slots.findIndex(x=>x.id===form.last_slot_id);
  const invalid=form.source_type_id && (!form.repeat_mode || start<0 || end<start);
  async function save(){
    onBusy(true);setNotice("");
    try{
      const updated=await request<Layout>("/admin/page_layout",{method:"POST",body:JSON.stringify({layout_id:layout.id,
        expected_revision:layout.revision,selection:form.source_type_id?form:null})});
      setForm(selection(updated));onSave(updated);setLatest(null);setNotice("Выборка сохранена.");
    }catch(e){
      setNotice(e instanceof Error?e.message:String(e));
      if(e instanceof ApiError && e.code==="version_conflict"){
        try{setLatest(await request<Layout>("/admin/layouts/"+layout.id));}catch(err){setNotice(String(err));}
      }
    }finally{onBusy(false);}
  }
  return <section className="pe-selection"><h2>Выборка и повтор</h2>
    <fieldset className="pe-controls" disabled={busy || layout.assigned}><label>Источник<select aria-label="Источник" value={form.source_type_id ?? ""} onChange={e=>change(e.target.value?{source_type_id:root,repeat_mode:form.repeat_mode ?? "block"}:{source_type_id:null,filter_type_id:null,filter_text:null,repeat_mode:null,first_slot_id:null,last_slot_id:null})}>
      <option value="">Без выборки</option><option value={root}>{types.find(t=>t.id===root)?.name}</option></select></label>
    {form.source_type_id && <><label>Тип записей<select aria-label="Тип записей" value={form.filter_type_id ?? ""} onChange={e=>change({filter_type_id:e.target.value||null})}>
      <option value="">Все типы источника</option>{branch.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      <label>Текст фильтра<input value={form.filter_text ?? ""} onChange={e=>change({filter_text:e.target.value||null})}/></label>
      <label>Режим повтора<select aria-label="Режим повтора" value={form.repeat_mode ?? "block"} onChange={e=>change({repeat_mode:e.target.value as "block"|"journal"})}>
        <option value="block">Блок для каждой записи</option><option value="journal">Журнальный</option></select></label>
      {(["first_slot_id","last_slot_id"] as const).map((key,i)=>{const label=i?"Конец повтора":"Начало повтора";return <label key={key}>{label}<select aria-label={label} value={form[key] ?? ""} onChange={e=>change({[key]:e.target.value||null})}>
        <option value="">Выберите слот</option>{slots.map(s=><option key={s.id} value={s.id}>{slotName(s.id)}</option>)}</select></label>;})}
    </>}
    <button disabled={!!invalid || !!latest} onClick={save}>Сохранить выборку</button></fieldset>
    {invalid && <p>Укажите начало и конец в порядке чтения слотов.</p>}
    <p role="status">{notice}</p>
    {latest && <div><h3>Сохранённая версия {latest.revision}</h3>
      <p>{types.find(t=>t.id===latest.source_type_id)?.name ?? "Без выборки"} · {types.find(t=>t.id===latest.filter_type_id)?.name ?? "Все типы"} · {latest.filter_text || "Без текста фильтра"} · {latest.repeat_mode==="journal"?"Журнальный":latest.repeat_mode?"Блок":"Без повтора"} · {slotName(latest.first_slot_id,latest)} — {slotName(latest.last_slot_id,latest)}</p>
      <button onClick={()=>{setForm(selection(latest));onSave(latest);setLatest(null);setNotice("");}}>Загрузить сохранённую версию</button>
      <button onClick={()=>{onSave(latest);setLatest(null);setNotice("Проверьте свои настройки перед сохранением.");}}>Продолжить со своими настройками</button></div>}
    {layout.repeat_mode && <details open><summary>Предпросмотр сохранённой выборки</summary>
      {preview?.items.length?<ol>{preview.items.map((item,i)=><li key={i}>{slotName(item.slot_id)} · UID {item.entity_id}</li>)}</ol>:<p>{previewError || (preview?"Нет записей по фильтру.":"Загрузка…")}</p>}</details>}
  </section>;
}
