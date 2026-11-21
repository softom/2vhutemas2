import type { Contract } from "./SlotProperties";
import { useRef, useState, type DragEvent } from "react";
import { request } from "../api";
import type { Layout, Slot } from "./PageEditor";

export type WidgetDefinition = { id: string; name: string; renderer_key: string; instance: Contract | null; widths: number[]; heights: number[] };
type Source = { widget: WidgetDefinition; slot?: Slot; width: number; height: number };
type Cell = { row: number; col: number };

function obstacle(layout: Layout, source: Source, {row,col}: Cell) {
  if (!source.widget.widths.length) return "Реализация виджета недоступна.";
  if (col + source.width - 1 > layout.grid_columns) return "Не хватает колонок справа.";
  const frame = ["site_menu", "site_footer"].includes(source.widget.renderer_key);
  if (frame && layout.slots.some(s => s.id !== source.slot?.id && s.widget_id === source.widget.id))
    return "Этот виджет уже есть в рамке страницы.";
  const hit = layout.slots.find(s => s.id !== source.slot?.id &&
    s.column_start < col + source.width && col < s.column_start + s.column_span &&
    s.row_start < row + source.height && row < s.row_start + s.row_span);
  return hit ? "Место занимает «" + hit.widget_name + "»." : "";
}

export function PlacementBoard({layout,widgets,selected,busy,onSelect,onSave,onBusy}: {
  layout: Layout | null; widgets: WidgetDefinition[]; selected: string; busy: boolean;
  onSelect: (id: string) => void; onSave: (layout: Layout) => void; onBusy: (busy: boolean) => void;
}) {
  const [source,setSource] = useState<Source | null>(null);
  const [hover,setHover] = useState<Cell | null>(null);
  const [message,setMessage] = useState("");
  const saving = useRef(false);
  const editable = !!layout && !layout.assigned && !busy;
  const columns = layout?.grid_columns ?? 4;
  const current = layout?.slots.find(s => s.id === selected);
  const cells = new Set<number>([1]);
  for (const s of layout?.slots ?? []) {
    for (let i=0; i<=s.row_span; i++) cells.add(s.row_start+i);
    if (s.row_start>1) cells.add(s.row_start-1);
  }
  const rows = [...cells].sort((a,b)=>a-b);
  function pick(widget: WidgetDefinition, slot?: Slot) {
    const width = source?.widget.id === widget.id && source.slot?.id === slot?.id
      ? source.width : slot?.column_span ?? widget.widths[0] ?? 1;
    setSource({widget,slot,width,height:slot?.row_span ?? widget.heights[0] ?? 1});
    setMessage(""); setHover(null);
    if (slot) onSelect(slot.id);
  }
  function drag(event: DragEvent, widget: WidgetDefinition, slot?: Slot) {
    if (!editable) { event.preventDefault(); return; }
    event.dataTransfer.effectAllowed = slot ? "move" : "copy";
    event.dataTransfer.setData("text/plain",slot?.id ?? widget.id);
    pick(widget,slot);
  }
  function cellAt(event: DragEvent) {
    const node = document.elementsFromPoint(event.clientX,event.clientY).find(el =>
      event.currentTarget.contains(el) && el.hasAttribute("data-drop-row")) as HTMLElement | undefined;
    return node ? { row:Number(node.dataset.dropRow),col:Number(node.dataset.dropCol) } : null;
  }
  async function place(cell: Cell) {
    if (!layout || !source || !editable || saving.current) return;
    const reason = obstacle(layout,source,cell);
    if (reason) { setMessage(reason); setHover(null); return; }
    saving.current=true; onBusy(true); setHover(null);
    try {
      const old = source.slot;
      const updated = await request<Layout>("/admin/page_layout",{method:"POST",body:JSON.stringify({
        layout_id: layout.id, expected_revision: layout.revision, id:old?.id, widget_id:source.widget.id,
        sort_order:old?.sort_order ?? Math.max(0,...layout.slots.map(s=>s.sort_order))+1,
        row_start:cell.row,column_start:cell.col,row_span:source.height,column_span:source.width,
      })});
      const id = old?.id ?? updated.slots.find(s=>!layout.slots.some(prev=>prev.id===s.id))?.id;
      onSave(updated); if (id) onSelect(id);
      setSource(null); setMessage("Размещение сохранено.");
    } catch(e) {setMessage(e instanceof Error ? e.message : String(e));}
    finally {saving.current=false;onBusy(false);}
  }
  const reason = layout && source && hover ? obstacle(layout,source,hover) : "";
  return <>
    <aside><h2>Каталог виджетов</h2><ul className="pe-palette">{widgets.map(w=><li key={w.id}>
      <button type="button" disabled={!editable || !w.widths.length} draggable={editable}
        aria-pressed={source?.widget.id===w.id && !source.slot}
        onDragStart={e=>drag(e,w)} onDragEnd={()=>setHover(null)} onClick={()=>pick(w)}>{w.name}</button>
    </li>)}</ul></aside>
    <section><h2>Сетка макета</h2>
      {layout?.assigned && <p>Для перемещения создайте рабочую копию.</p>}
      {source && <div className="pe-placement"><label>Ширина слота
        <select aria-label="Ширина слота" value={source.width} onChange={e=>setSource({...source,width:Number(e.target.value)})}>
          {source.widget.widths.map(w=><option key={w} value={w}>{w}</option>)}</select></label>
        <span>{source.widget.name} · выберите ячейку</span>
        <button type="button" onClick={()=>{setSource(null);setHover(null);setMessage("");}}>Отмена</button>
      </div>}
      {editable && current && !source && <button type="button" onClick={()=>{
        const w=widgets.find(w=>w.id===current.widget_id); if(w) pick(w,current);
      }}>Переместить выбранный слот</button>}
      <p role="status" className="pe-feedback">{reason || message || (hover && source ? `Строка ${hover.row}, колонка ${hover.col}, ширина ${source.width}.` : "")}</p>
      <div className="pe-grid" style={{gridTemplateColumns:`repeat(${columns}, minmax(0, 1fr))`}}
        onDragOver={e=>{if (!source || !editable) return; const cell=cellAt(e); if(cell){e.preventDefault();setHover(cell);}}}
        onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node | null))setHover(null);}}
        onDrop={e=>{e.preventDefault();const cell=cellAt(e);if(cell)void place(cell);}}>
        {Array.from({length:columns},(_,i)=><span className="pe-track" key={i}>Колонка {i+1}</span>)}
        {rows.flatMap((row,index)=>Array.from({length:columns},(_,i)=>{
          const col=i+1;
          const hot=!!source && !!hover && row>=hover.row && row<hover.row+source.height && col>=hover.col && col<hover.col+source.width;
          return <button type="button" key={row+":"+col} data-drop-row={row} data-drop-col={col} disabled={!editable || !source}
            aria-label={`Строка ${row}, колонка ${col}`} data-target={hot ? reason ? "invalid" : "valid" : undefined}
            style={{gridColumn:col,gridRow:index+2}} onFocus={()=>source && setHover({row,col})}
            onClick={()=>void place({row,col})}/>;
        }))}
        {layout?.slots.map(s=>{
          const w=widgets.find(w=>w.id===s.widget_id);
          return <button type="button" key={s.id} className="pe-slot" data-slot-id={s.id} draggable={editable && !!w}
            aria-pressed={selected===s.id} style={{gridColumn:`${s.column_start}/span ${s.column_span}`,
              gridRow:`${rows.indexOf(s.row_start)+2}/span ${s.row_span}`}}
            onDragStart={e=>w && drag(e,w,s)} onDragEnd={()=>setHover(null)}
            onClick={()=>{if(source)void place({row:s.row_start,col:s.column_start});else onSelect(s.id);}}>
            {s.widget_name ?? w?.name}<small>Ширина {s.column_span} · порядок {s.sort_order}</small></button>;
        })}
      </div>
      {!busy && !layout?.slots.length && <p>Слотов пока нет.</p>}
    </section>
  </>;
}
