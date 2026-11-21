import { SelectionPanel, type Selection, sectionSources } from "./SelectionPanel";
import { SlotProperties, type Values } from "./SlotProperties";
import { PlacementBoard, type WidgetDefinition } from "./PlacementBoard";
import { useEffect, useState } from "react";
import { request } from "../api";

type Named = { id: string; name: string };
type Page = Named & { current_layout_id: string | null };
type Summary = Named & { page_id: string; assigned: boolean };
export type Slot = { id: string; widget_id: string; widget_name: string; sort_order: number; row_start: number;
  design: string | null; display_options: Values; call_params: Values; column_start: number; row_span: number; column_span: number };
export type Layout = Summary & Selection & { revision: number; grid_columns: 3 | 4; slots: Slot[] };
type Catalog = { card_page_id: string; pages: Page[]; types: (Named & { parent_id: string | null; layout_id: string | null })[];
  layouts: Summary[]; widgets: WidgetDefinition[] };

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export default function PageEditor() {
  const [catalog, setCatalog] = useState<Catalog>();
  const [pageId, setPageId] = useState("");
  const [typeId, setTypeId] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const ctrl = new AbortController();
    request<Catalog>("/admin/page-editor", { signal: ctrl.signal }).then(data => {
      setPageId(data.card_page_id);
      setCatalog(data);
    }).catch(e => { if (!ctrl.signal.aborted) setError(errorText(e)); });
    return () => ctrl.abort();
  }, []);
  const page = catalog?.pages.find(p => p.id === pageId);
  return <section className="page-editor"><h1>Макеты страниц</h1>
    {error && <p role="alert">{error}</p>}
    {catalog && page ? <>
      <div className="pe-controls">
        <label>Страница<select aria-label="Страница" value={pageId} onChange={e => {setPageId(e.target.value); setTypeId("");}}>
          {catalog.pages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select></label>
        {pageId === catalog.card_page_id && <label>Тип карточки<select aria-label="Тип карточки" value={typeId} onChange={e => setTypeId(e.target.value)}>
          <option value="">Общий макет карточки</option>
          {catalog.types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select></label>}
      </div>
      <Workspace key={pageId + typeId} page={page} typeId={typeId} catalog={catalog}
        onCreated={layout => setCatalog(current => current && ({...current,layouts:[...current.layouts,layout]}))}/>
    </> : !error && <p role="status">Загрузка каталога…</p>}
  </section>;
}

function Workspace({page,typeId,catalog,onCreated}: {page: Page; typeId: string; catalog: Catalog; onCreated: (l: Layout) => void}) {
  const versions = catalog.layouts.filter(l => l.page_id === page.id);
  const [active, setActive] = useState<string | null>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [chosen, setChosen] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState("");
  const [ready, setReady] = useState(false);
  const [marks,setMarks] = useState<{layoutId:string;first:string;last:string} | null>(null);
  const slot = layout?.slots.find(s => s.id === selected);
  const inherited = !!typeId && active && !catalog.types.find(t => t.id === typeId)?.layout_id;
  const firstVersion = versions[0]?.id ?? "";
  useEffect(() => {
    const ctrl = new AbortController();
    async function init() {
      const effective = typeId ? await request<Layout | null>("/admin/type_presentations/"+typeId+"/layout",{signal:ctrl.signal}) : null;
      const id = typeId ? effective?.id ?? null : page.current_layout_id;
      setActive(id);
      setChosen(id ?? firstVersion);
      setReady(true);
    }
    init().catch(e => { if (!ctrl.signal.aborted) {setError(errorText(e)); setBusy(false);} });
    return () => ctrl.abort();
  }, [page.id, page.current_layout_id, typeId]); // A newly created copy is selected directly.
  useEffect(() => {
    if (!ready) return;
    const ctrl = new AbortController();
    setError(""); setLayout(null); setSelected(""); setName(""); setBusy(!!chosen);
    if (chosen) request<Layout>("/admin/layouts/"+chosen,{signal:ctrl.signal}).then(l => {
      if (ctrl.signal.aborted) return;
      setLayout(l); setSelected(l.slots[0]?.id ?? ""); setBusy(false);
    }).catch(e => {if (!ctrl.signal.aborted) {setError(errorText(e)); setBusy(false);}});
    return () => ctrl.abort();
  }, [chosen,ready]);
  async function create() {
    setBusy(true); setError("");
    try {
      const l = await request<Layout>(layout ? "/admin/layouts/"+layout.id+"/copy" : "/admin/layouts", {
        method:"POST",body:JSON.stringify({name:name.trim(),page_id:page.id,grid_columns:4}),
      });
      onCreated(l); setChosen(l.id);
    } catch(e) {setError(errorText(e)); setBusy(false);}
  }
  return <>
    <div className="pe-controls">
      <label>Макет<select aria-label="Макет" value={chosen} disabled={!ready || busy} onChange={e=>setChosen(e.target.value)}>
        <option value="">Новый пустой макет</option>
        {versions.map(l=><option key={l.id} value={l.id}>{l.name}{l.id===active ? " · действует" : ""}</option>)}
      </select></label>
      <label>Название рабочей копии<input value={name} disabled={!ready || busy} onChange={e=>setName(e.target.value)}/></label>
      <button disabled={!ready || busy || !name.trim() || (!!chosen && !layout)} onClick={create}>{chosen ? "Создать рабочую копию" : "Создать макет"}</button>
    </div>
    {ready && <p>Действующий макет: {versions.find(l=>l.id===active)?.name ?? "не назначен"}{inherited ? " (унаследован)" : ""}</p>}
    {error && <p role="alert">{error}</p>}
    {layout && sectionSources[page.id] && <SelectionPanel key={layout.id} layout={layout} types={catalog.types} root={sectionSources[page.id]} busy={busy} onBusy={setBusy} onSave={setLayout} onMarks={setMarks}/>}
    <div className="pe-workspace">
      <PlacementBoard key={chosen} layout={layout} widgets={catalog.widgets} selected={selected} busy={busy}
        first={marks?.layoutId===chosen?marks.first:layout?.first_slot_id} last={marks?.layoutId===chosen?marks.last:layout?.last_slot_id} onSelect={setSelected} onBusy={setBusy} onSave={setLayout} />
      <aside><h2>Выбранный слот</h2>{slot ? <><strong>{slot.widget_name ?? catalog.widgets.find(w=>w.id===slot.widget_id)?.name}</strong>
        <dl><dt>Строка</dt><dd>{slot.row_start}</dd><dt>Колонка</dt><dd>{slot.column_start}</dd>
        <dt>Ширина</dt><dd>{slot.column_span}</dd><dt>Высота</dt><dd>{slot.row_span}</dd><dt>Порядок чтения</dt><dd>{slot.sort_order}</dd></dl>{layout && <SlotProperties key={slot.id} slot={slot} layout={layout} widget={catalog.widgets.find(w=>w.id===slot.widget_id)} busy={busy} onBusy={setBusy} onSave={setLayout}/>}</>
        : <p>Слот не выбран.</p>}</aside>
    </div>
  </>;
}
