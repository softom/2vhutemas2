import { useEffect, useState } from "react";
import { request } from "../../src/api";

type Named = { id: string; name: string };
type Catalog = {
  page_id: string; current_layout_id: string | null;
  types: (Named & {layout_id: string | null})[]; layouts: Named[]; widgets: Named[];
};
type Slot = { id?: string; widget_id: string; design: string | null;
  sort_order: number; row_start: number; column_start: number; row_span: number; column_span: number };
type Layout = Named & { revision: number; assigned: boolean; slots: Slot[] };
const dimensions = [
  ["sort_order","Порядок"], ["row_start","Строка"], ["column_start","Колонка"],
  ["row_span","Высота"], ["column_span","Ширина"],
] as const;
function post<T>(path: string, data: unknown) {
  return request<T>("/admin/"+path,{method:"POST",body:JSON.stringify(data)});
}
export function CardLayoutEditor() {
  const [catalog,setCatalog]=useState<Catalog>();
  const [type,setType]=useState("");
  const [active,setActive]=useState<string|null>(null);
  const [layout,setLayout]=useState<Layout|null>(null);
  const [name,setName]=useState("");
  const [entity,setEntity]=useState("");
  const [preview,setPreview]=useState("");
  const [dirty,setDirty]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const loadCatalog=()=>request<Catalog>("/admin/card-layout-editor");
  function show(value:Layout|null) {
    setLayout(value);setDirty(false);setPreview("");
  }
  useEffect(()=>{
    let alive=true;
    loadCatalog().then(async c=>{
      const initial=c.current_layout_id ? await request<Layout>("/admin/layouts/"+c.current_layout_id) : null;
      if(alive){setCatalog(c);setActive(c.current_layout_id);show(initial);}
    }).catch(e=>{if(alive)setMessage(String(e))});
    return ()=>{alive=false};
  },[]);
  async function run(work:()=>Promise<void>) {
    setBusy(true);setMessage("");
    try{await work();}catch(e){setMessage(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  }
  if(!catalog)return <section><h1>Макеты карточки</h1><p>{message||"Загрузка…"}</p></section>;
  const assignmentPath=type ? "type_presentations/"+type+"/layout" : "pages/"+catalog.page_id+"/layout";
  function edit(index:number, patch:Partial<Slot>) {
    if(!layout)return;
    setLayout({...layout,slots:layout.slots.map((s,i)=>i===index?{...s,...patch}:s)});
    setDirty(true);setPreview("");
  }
  return <section><h1>Макеты карточки</h1><fieldset disabled={busy}>
    <label>Назначение <select value={type} disabled={dirty} onChange={e=>{
      const value=e.target.value; void run(async()=>{
        const effective=await request<Layout|null>(value?"/admin/type_presentations/"+value+"/layout":"/admin/pages/"+catalog.page_id+"/layout");
        setType(value);setActive(value?catalog.types.find(t=>t.id===value)?.layout_id??null:catalog.current_layout_id);
        show(effective);
      });
    }}><option value="">Общая карточка</option>{catalog.types.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
    <label>Макет <select value={layout?.id??""} disabled={dirty} onChange={e=>{
      const id=e.target.value; void run(async()=>show(id?await request<Layout>("/admin/layouts/"+id):null));
    }}><option value="">Без собственного макета</option>{catalog.layouts.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
    <label>Название новой версии <input value={name} onChange={e=>setName(e.target.value)}/></label>
    <button disabled={!name.trim()||dirty} onClick={()=>void run(async()=>{
      const created=await post<Layout>(layout?"layouts/"+layout.id+"/copy":"layouts",{page_id:catalog.page_id,name});
      setCatalog(await loadCatalog());show(await request<Layout>("/admin/layouts/"+created.id));setName("");
    })}>{layout?"Создать копию":"Создать макет"}</button>
    {layout&&<><table><thead><tr><th>Виджет</th>{dimensions.map(([key,label])=><th key={key}>{label}</th>)}<th>Дизайн</th></tr></thead>
      <tbody>{layout.slots.map((s,i)=><tr key={s.id??"new-"+i}><td><select aria-label="Виджет" value={s.widget_id} disabled={layout.assigned} onChange={e=>edit(i,{widget_id:e.target.value})}>
        {catalog.widgets.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></td>
      {dimensions.map(([key,label])=><td key={key}><input type="number" aria-label={label} value={s[key]} disabled={layout.assigned}
        onChange={e=>edit(i,{[key]:Number(e.target.value)})}/></td>)}<td><input aria-label="Дизайн" value={s.design??""} disabled={layout.assigned} onChange={e=>edit(i,{design:e.target.value||null})}/></td></tr>)}</tbody></table>
      {!layout.assigned&&<><button disabled={!catalog.widgets.length} onClick={()=>{
        setLayout({...layout,slots:[...layout.slots,{widget_id:catalog.widgets[0].id,design:null,
          sort_order:1+Math.max(0,...layout.slots.map(s=>s.sort_order)),row_start:Math.max(1,...layout.slots.map(s=>s.row_start+s.row_span)),
          column_start:1,row_span:1,column_span:1}]});setDirty(true);setPreview("");
      }}>Добавить слот</button><button disabled={!dirty} onClick={()=>void run(async()=>show(await post<Layout>("page_layout",{
        layout_id:layout.id,expected_revision:layout.revision,slots:layout.slots
      })))}>Сохранить слоты</button><button disabled={!dirty} onClick={()=>void run(async()=>show(await request<Layout>("/admin/layouts/"+layout.id)))}>Отменить правки</button></>}
      <label>UID записи для превью <input value={entity} onChange={e=>{setEntity(e.target.value);setPreview("")}}/></label>
      <button disabled={dirty||!/^\d+$/.test(entity)} onClick={()=>void run(async()=>{
        const card=await request<{html:string}>("/entities/"+entity+"/card?preview_layout_id="+layout.id);
        const css=Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).map(l=>l.outerHTML).join("");
        setPreview("<!doctype html><html lang='ru'><head>"+css+"</head><body><main>"+card.html+"</main></body></html>");
      })}>Предпросмотр</button></>}
    <button disabled={dirty||(layout?.id??null)===active||(!!layout&&!preview)} onClick={()=>void run(async()=>{
      await post(assignmentPath,{layout_id:layout?.id??null,expected_layout_id:active,expected_revision:layout?.revision});
      setCatalog(await loadCatalog());setActive(layout?.id??null);
      show(layout?await request<Layout>("/admin/layouts/"+layout.id):null);setMessage("Назначение сохранено");
    })}>{layout?"Назначить выбранную версию":"Снять назначение"}</button>
  </fieldset>{message&&<p role="status">{message}</p>}{preview&&<iframe title="Предпросмотр карточки" sandbox="" srcDoc={preview} style={{width:"100%",height:"70vh",border:0}}/>}</section>;
}
