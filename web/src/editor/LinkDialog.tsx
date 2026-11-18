/**
 * Окно связи: связать запись с другой и объяснить, на каком основании.
 *
 * Связь не существует без обоснования — это правило держит и база (Р-23).
 * Поэтому окно требует текст: не «подтвердите», а «объясните».
 *
 * Вставка в текст связью не является: там остаётся ссылка на запись и её
 * отображение. Здесь — утверждение об отношении двух записей.
 */
import { useEffect, useState } from "react";
import { api, type Capabilities, type EntityListItem } from "../api";
import { Modal } from "../ui/Modal";

interface Props {
  fromEntityId: number;
  toEntityId: number;
  toTitle: string;
  onLinked: () => void;
  onClose: () => void;
}

export function LinkDialog({ fromEntityId, toEntityId, toTitle, onLinked, onClose }: Props) {
  const [roles, setRoles] = useState<{ code: string; title_ru: string }[]>([]);
  const [role, setRole] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [query,setQuery]=useState("");
  const [sources,setSources]=useState<EntityListItem[]>([]);
  const [source,setSource]=useState<EntityListItem|null>(null);
  const [searching,setSearching]=useState(false);
  const [searchError,setSearchError]=useState("");
  const [quote,setQuote]=useState("");
  const [locator,setLocator]=useState("");
  const [accessedAt,setAccessedAt]=useState("");

  useEffect(()=>{
    let active=true;
    setSources([]);setSearchError("");setSearching(false);
    if(query.trim().length<2||source)return;
    const timer=setTimeout(()=>{
      setSearching(true);
      api.entities({q:query.trim(),limit:"10"}).then(r=>{if(active)setSources(r.items);})
        .catch(e=>{if(active)setSearchError((e as Error).message);})
        .finally(()=>{if(active)setSearching(false);});
    },250);
    return ()=>{active=false;clearTimeout(timer);};
  },[query,source]);

  useEffect(() => {
    api.capabilities()
      .then((caps: Capabilities) => setRoles(caps.dictionaries.link_roles ?? []))
      .catch(() => {});
  }, []);

  const save = async () => {
    if (!text.trim()) {
      setError("Связь не сохраняется без объяснения, на каком она основании");
      return;
    }
    if((source&&!quote.trim())||(!source&&quote.trim())){
      setError("Для цитаты выберите источник и заполните текст цитаты");return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.createLink({
        from_entity_id: fromEntityId,
        to_entity_id: toEntityId,
        role: role || null,
        justification: source ? {body:[
          {id:crypto.randomUUID(),type:"paragraph",content:[{type:"text",text:text.trim(),styles:{}}]},
          {id:crypto.randomUUID(),type:"quote",content:[{type:"text",text:quote.trim(),styles:{}},
            {type:"sourceRef",props:{entityId:String(source.id),occurrenceId:crypto.randomUUID(),title:source.title_ru,note:locator.trim(),accessedAt}}]},
        ]} : { text: text.trim() },
      });
      onLinked();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`Связать с «${toTitle}»`}
      dirty={Boolean(text.trim()||source||quote.trim())}
      onClose={onClose}
      footer={
        <>
          <button type="button" disabled={saving} onClick={save}>Связать</button>
          <button type="button" className="ghost" onClick={onClose}>Отмена</button>
        </>
      }
    >
      <div className="form">
        {error && <p className="error">{error}</p>}

        <label>
          Роль связи
          <select value={role} onChange={(event) => setRole(event.target.value)}>
            <option value="">без роли</option>
            {roles.map((item) => (
              <option key={item.code} value={item.code}>{item.title_ru}</option>
            ))}
          </select>
          <span className="hint">Кем или чем одна запись приходится другой</span>
        </label>

        <label>
          На каком основании
          <textarea
            autoFocus
            rows={4}
            value={text}
            placeholder="Мейерхольд участвовал в разработке сценической системы «Теомасс» — переписка 1930 года"
            onChange={(event) => setText(event.target.value)}
          />
          <span className="hint">
            Связать можно что угодно с чем угодно; свобода оплачивается обязанностью объяснить
          </span>
        </label>
        <fieldset disabled={saving}>
          <legend>Цитата из источника — необязательно</legend>
          {source ? <p>Источник: <a href={`/entities/${source.id}`} target="_blank" rel="noreferrer">{source.title_ru}</a>{" "}<button type="button" className="ghost" onClick={()=>{setSource(null);setQuery("");}}>Сменить источник</button></p> : <>
            <label>Найти сущность источника<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Название книги, статьи или веб-страницы" /></label>
            <p className="hint">URL хранится в карточке источника. Здесь выбирается существующая запись.</p>
            <div aria-live="polite">{searching&&<p>Ищем источники…</p>}{searchError&&<p className="error">{searchError}</p>}</div>
            {sources.length>0&&<ul>{sources.map(s=><li key={s.id}><button type="button" className="ghost" onClick={()=>setSource(s)}>{s.title_ru}</button></li>)}</ul>}
          </>}
          <label>Точная цитата<textarea rows={4} value={quote} onChange={e=>setQuote(e.target.value)} /></label>
          <label>Страница или раздел<input value={locator} onChange={e=>setLocator(e.target.value)} placeholder="Например, с. 24, раздел «Конструкция»" /></label>
          <label>Дата обращения<input type="date" value={accessedAt} onChange={e=>setAccessedAt(e.target.value)} /></label>
          <p className="hint">Для другого источника создайте отдельную связь. Цитата сохраняется вместе с версией обоснования.</p>
        </fieldset>
      </div>
    </Modal>
  );
}
