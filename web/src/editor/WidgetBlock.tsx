import { useEffect, useState } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { api, type SearchHit } from "../api";

type WidgetProps = { widget_id: string; entity_id: string; design: string };
type Definition = Awaited<ReturnType<typeof api.documentWidgets>>["items"][number];

function previewDocument(html: string) {
  const doc = document.implementation.createHTMLDocument("Превью виджета");
  for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')) {
    if (new URL(link.href).origin !== location.origin) continue;
    const style = doc.createElement("link");
    style.rel = "stylesheet";
    style.href = link.href;
    doc.head.append(style);
  }
  doc.body.className = "public-document";
  doc.body.innerHTML = html;
  return "<!doctype html>" + doc.documentElement.outerHTML;
}

function WidgetPreview({ widget_id, entity_id, design }: WidgetProps) {
  const [preview, setPreview] = useState<{html: string; title: string}>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api.documentWidgetPreview(widget_id, entity_id, design)
      .then(data => { if (active) setPreview(data); })
      .catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [widget_id, entity_id, design]);
  if (error) return <p role="alert">{error}</p>;
  if (!preview) return <p role="status">Загрузка превью…</p>;
  return <figure>
    <figcaption>{preview.title}</figcaption>
    {preview.html ? <iframe title="Превью виджета" sandbox="" srcDoc={previewDocument(preview.html)} />
      : <p>Для этой записи у виджета нет данных.</p>}
  </figure>;
}

function WidgetEditor({ value, change }: {value: WidgetProps; change: (next: Partial<WidgetProps>) => void}) {
  const [catalog, setCatalog] = useState<Definition[]>([]);
  const [catalogError, setCatalogError] = useState("");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searchStatus, setSearchStatus] = useState("");
  useEffect(() => {
    let active = true;
    api.documentWidgets().then(data => { if (active) setCatalog(data.items); })
      .catch(e => { if (active) setCatalogError(e.message); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    setHits([]);
    setSearchStatus("");
    if (!query.trim()) return;
    const timer = setTimeout(() => {
      api.search({q: query.trim(), limit: 8}).then(data => {
        if (active) { setHits(data.items); setSearchStatus(data.items.length ? "" : "Записей не найдено."); }
      }).catch(e => { if (active) setSearchStatus(e.message); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [query]);
  const chosen = catalog.find(widget => widget.id === value.widget_id);
  return <div className="document-widget-editor" contentEditable={false}>
    <label>Виджет <select aria-label="Виджет" value={value.widget_id} onChange={e => change({widget_id: e.target.value, design: ""})}>
      <option value="">Выберите виджет</option>
      {value.widget_id && !chosen && <option value={value.widget_id}>Виджет вне каталога</option>}
      {catalog.map(widget => <option key={widget.id} value={widget.id}>{widget.name}</option>)}
    </select></label>
    {catalogError && <p role="alert">{catalogError}</p>}
    {chosen && <label>Оформление <select aria-label="Оформление" value={value.design} onChange={e => change({design: e.target.value})}>
      <option value="">По умолчанию</option>
      {chosen.designs.map(design => <option key={design}>{design}</option>)}
    </select></label>}
    <label>Запись <input type="search" value={query} placeholder="Поиск по названию" onChange={e => setQuery(e.target.value)} /></label>
    {searchStatus && <p role="status">{searchStatus}</p>}
    {hits.length > 0 && <ul>{hits.map(hit => <li key={hit.id}><button type="button" onClick={() => {
      change({entity_id: String(hit.id)}); setQuery("");
    }}>{hit.title_ru} · {hit.type_title ?? hit.type} · UID {hit.id}</button></li>)}</ul>}
    {value.entity_id && <p>UID {value.entity_id} <button type="button" onClick={() => change({entity_id: ""})}>Снять выбор</button></p>}
    {chosen && value.entity_id && <WidgetPreview key={JSON.stringify(value)} {...value} />}
  </div>;
}

export const WidgetBlock = createReactBlockSpec({
  type: "widget",
  propSchema: {widget_id: {default: ""}, entity_id: {default: ""}, design: {default: ""}},
  content: "none",
}, {
  render: ({block, editor}) => <WidgetEditor value={block.props}
    change={props => editor.updateBlock(block, {type: "widget", props: {...block.props, ...props}})} />,
});
