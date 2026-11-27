import { useEffect, useState } from "react";
import { request } from "../api";
import { designTitle } from "../widgetModes";
import type { Slot, Layout } from "./PageEditor";
import type { WidgetDefinition } from "./PlacementBoard";

type Field = { type:"text"|"integer"|"entity_uid"; default:string|number|null; min?:number; max?:number; aliases?:string[] };
export type Contract = {design:{values:string[];default:string;titles?:Record<string,string>}; display_options:Record<string,Field>; call_params:Record<string,Field>};
export type Values = Record<string,string|number|null|{alias:string}>;
const labels:Record<string,string>={entity_id:"Сущность",height:"Высота модели",title:"Заголовок",caption:"Подпись"};

export function SlotProperties({slot,layout,widget,busy,onSave,onBusy}:{
  slot:Slot;layout:Layout;widget?:WidgetDefinition;busy:boolean;onSave:(l:Layout)=>void;onBusy:(b:boolean)=>void;
}) {
  const [design,setDesign]=useState(slot.design ?? "");
  const [display,setDisplay]=useState<Values>(slot.display_options ?? {});
  const [params,setParams]=useState<Values>(slot.call_params ?? {});
  const [context,setContext]=useState("");
  const [notice,setNotice]=useState("");
  const [preview,setPreview]=useState({html:"",reason:""});
  const contract=widget?.instance;
  const entity=params.entity_id;
  const uid=typeof entity==="string"?entity:context;
  const query=new URLSearchParams();
  if(uid) query.set("entity_id",uid);
  if(design) query.set("design",design);
  for(const [key,value] of Object.entries(display)) query.set(key,String(value));
  const frame=widget?.renderer_key==="site_menu" || widget?.renderer_key==="site_footer";
  const needsContext=!!contract?.call_params.entity_id;
  const url=!widget || !contract || (needsContext && !uid) ? "" : frame ? "/site-header?path=/" : "/document-widgets/"+widget.id+"/preview?"+query;
  useEffect(()=>{
    const ctrl=new AbortController();
    setPreview({html:"",reason:""});
    if(!url)return;
    const timer=setTimeout(()=>{request<{html:string;footer?:string;reason?:string}>(url,{signal:ctrl.signal}).then(result=>{
      if(!ctrl.signal.aborted)setPreview({html:widget?.renderer_key==="site_footer"?result.footer ?? "":result.html,reason:result.reason ?? ""});
    }).catch(e=>{if(!ctrl.signal.aborted)setPreview({html:"",reason:String(e.message ?? e)});});},200);
    return ()=>{clearTimeout(timer);ctrl.abort();};
  },[url,widget?.renderer_key]);
  if(!contract)return <p>Свойства виджета недоступны.</p>;
  function fields(schema:Record<string,Field>,values:Values,set:(v:Values)=>void){
    return Object.entries(schema).map(([key,f])=>{
      const value=values[key] ?? f.default;
      const label=labels[key] ?? key;
      function change(v:Values[string]){setNotice("");set({...values,[key]:v});}
      if(f.type==="entity_uid"){
        const mode=typeof value==="object" && value?value.alias:typeof value==="string"?"uid":"";
        return <div key={key}><label>{label}<select value={mode} onChange={e=>change(e.target.value==="uid"?"":e.target.value?{alias:e.target.value}:null)}>
          <option value="">По умолчанию</option>{f.aliases?.map(a=><option key={a}>{a}</option>)}<option value="uid">Фиксированный UID</option>
        </select></label>{mode==="uid" && <label>UID сущности<input required pattern="[1-9][0-9]*" value={String(value)} onChange={e=>change(e.target.value)}/></label>}</div>;
      }
      return <label key={key}>{label}<input type={f.type==="integer"?"number":"text"} min={f.min} max={f.max} required={f.type==="integer"}
        value={String(value ?? "")} onChange={e=>change(f.type==="integer" && e.target.value!==""?Number(e.target.value):e.target.value)}/></label>;
    });
  }
  async function save(){
    onBusy(true);setNotice("");
    try{
      const updated=await request<Layout>("/admin/page_layout",{method:"POST",body:JSON.stringify({...slot,layout_id:layout.id,
        expected_revision:layout.revision,design:design || null,display_options:display,call_params:params})});
      onSave(updated);setNotice("Свойства сохранены.");
    }catch(e){setNotice(e instanceof Error?e.message:String(e));}finally{onBusy(false);}
  }
  const css=Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).map(l=>'<link rel="stylesheet" href="'+l.href+'">').join("");
  return <div className="pe-properties"><form onSubmit={e=>{e.preventDefault();void save();}}>
    <fieldset disabled={busy || layout.assigned}><legend>Отображение</legend>
      <label>Оформление<select value={design} onChange={e=>{setDesign(e.target.value);setNotice("");}}>
        <option value="">По умолчанию ({designTitle(contract.design.default, contract.design.titles)})</option>{contract.design.values.map(d=><option key={d}>{designTitle(d, contract.design.titles)}</option>)}
      </select></label>{fields(contract.display_options,display,setDisplay)}
    </fieldset><fieldset disabled={busy || layout.assigned}><legend>Начальные параметры вызова</legend>
      {fields(contract.call_params,params,setParams)}{!Object.keys(contract.call_params).length && <small>Нет параметров вызова.</small>}
    </fieldset><button disabled={busy || layout.assigned}>Сохранить свойства</button><p role="status">{notice}</p>
    </form><h3>Предпросмотр</h3>{needsContext && typeof entity!=="string" && <label>UID для предпросмотра<input inputMode="numeric" value={context} onChange={e=>setContext(e.target.value)}/></label>}
    {preview.html?<iframe title="Предпросмотр виджета" sandbox="" srcDoc={css+preview.html}/>:<p>{preview.reason || (url?"Загрузка…":"Укажите UID для предпросмотра.")}</p>}
  </div>;
}
