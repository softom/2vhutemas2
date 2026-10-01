/**
 * Окно вставки и прикрепления — на весь экран, с фильтрами сверху.
 *
 * Прежде это была узкая колонка справа от текста: список в одну плитку
 * шириной, без отбора, с кнопками за краем прокрутки. Здесь — сетка
 * крупных карточек и фильтры, которыми сужают поиск.
 *
 * Два раздела, потому что в текст вставляются две вещи: записи и изображения.
 *   * Запись — карточкой отдельным блоком или упоминанием в строке. Вставка
 *     связью не является (Р-23, Р-45); «Связать» — отдельное действие с
 *     обоснованием.
 *   * Изображение — в текст блоком или прикреплением к записи: прикрепление —
 *     связь «иллюстрация» (Р-84), поэтому возможно только у сохранённой записи.
 *
 * Окно не закрывается после действия: в лекцию вставляют подряд.
 */
import { useEffect, useState } from "react";
import {
  api,
  compactParts,
  type EntityListItem,
  type EntityType,
  type MediaAsset,
} from "../api";
import { Modal } from "../ui/Modal";
import { type InsertableEntity, SourceMark } from "./entityBlocks";
import { LinkDialog } from "./LinkDialog";
import { MediaDialog } from "./MediaDialog";

export type PickerTab = "entities" | "media";

interface Props {
  entityId: number | null;
  types: EntityType[];
  initialTab?: PickerTab;
  /** Изображения, уже прикреплённые к записи. */
  attached: { asset_id: string }[];
  onInsertCard: (entity: InsertableEntity) => void;
  onInsertMention: (entity: InsertableEntity) => void;
  onInsertMedia: (asset: MediaAsset) => void;
  /** Прикрепления изменились — карточке пора перечитать список. */
  onChanged: () => void;
  onClose: () => void;
}

interface LinkedItem {
  other_id: number;
}

export function InsertPicker(props: Props) {
  const [tab, setTab] = useState<PickerTab>(props.initialTab ?? "entities");
  // Что сделано в этом окне: отметка остаётся на карточке, чтобы было видно,
  // что вставка состоялась, — текст под окном не виден.
  const [done, setDone] = useState<Record<string, string>>({});
  const mark = (key: string, text: string) => setDone((current) => ({ ...current, [key]: text }));

  return (
    <Modal
      full
      title="Вставить или прикрепить"
      onClose={props.onClose}
      footer={<button type="button" onClick={props.onClose}>Готово</button>}
    >
      <div className="panel-tabs picker-tabs">
        <button type="button" className={tab === "entities" ? "active" : "ghost"} onClick={() => setTab("entities")}>
          Записи
        </button>
        <button type="button" className={tab === "media" ? "active" : "ghost"} onClick={() => setTab("media")}>
          Изображения
        </button>
      </div>
      {tab === "entities"
        ? <EntitiesTab {...props} done={done} mark={mark} />
        : <MediaTab {...props} done={done} mark={mark} />}
    </Modal>
  );
}

interface TabProps extends Props {
  done: Record<string, string>;
  mark: (key: string, text: string) => void;
}

/** Ветви и типы дерева с отступом — как в каталоге. */
function TypeOptions({ types }: { types: EntityType[] }) {
  return (
    <>
      {types.map((type) => (
        <option key={type.code} value={type.code}>
          {"  ".repeat(type.depth) + (type.depth > 0 ? "– " : "") + type.title_ru}
        </option>
      ))}
    </>
  );
}

function EntitiesTab({ entityId, types, onInsertCard, onInsertMention, done, mark }: TabProps) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [scope, setScope] = useState<"all" | "linked">("all");
  const [items, setItems] = useState<EntityListItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [linked, setLinked] = useState<Set<number>>(new Set());
  const [linking, setLinking] = useState<{ id: number; title: string } | null>(null);

  const reloadLinks = () => {
    if (!entityId) return;
    api.links(entityId)
      .then((page) => setLinked(new Set((page.items as unknown as LinkedItem[]).map((item) => item.other_id))))
      .catch(() => setLinked(new Set()));
  };
  useEffect(reloadLinks, [entityId]);

  useEffect(() => {
    setLoading(true);
    const timer = setTimeout(() => {
      const search = query.trim();
      api.entities({ q: search.length >= 2 ? search : undefined, type: type || undefined })
        .then((page) => {
          setItems(page.items.filter((item) => item.id !== entityId));
          setCursor(page.next_cursor);
        })
        .catch(() => setItems([]))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [query, type, entityId]);

  const more = () => {
    if (!cursor) return;
    const search = query.trim();
    api.entities({ q: search.length >= 2 ? search : undefined, type: type || undefined, cursor })
      .then((page) => {
        setItems((current) => [...current, ...page.items.filter((item) => item.id !== entityId)]);
        setCursor(page.next_cursor);
      })
      .catch(() => {});
  };

  const shown = scope === "linked" ? items.filter((item) => linked.has(item.id)) : items;

  return (
    <>
      <div className="filters picker-filters">
        <input autoFocus placeholder="Поиск по названию" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Все ветви и типы</option>
          <TypeOptions types={types} />
        </select>
        <select value={scope} onChange={(e) => setScope(e.target.value as "all" | "linked")} disabled={!entityId}>
          <option value="all">Все записи</option>
          <option value="linked">Только связанные с этой записью</option>
        </select>
      </div>
      <p className="hint">
        «Карточкой» — отдельным блоком, «В строку» — упоминанием внутри абзаца. Вставка не связь:
        связь утверждает отношение и требует основания.
      </p>

      {loading && items.length === 0 && <p className="notice">Загружаем…</p>}
      {!loading && shown.length === 0 && <p className="notice">Ничего не нашлось.</p>}
      <div className="grid picker-grid">
        {shown.map((item) => {
          const view = compactParts(item.compact);
          const entity: InsertableEntity = { id: item.id, title_ru: item.title_ru, kind: item.type_title ?? item.type };
          const key = `e${item.id}`;
          return (
            <div className={view.portrait ? "card portrait" : "card"} key={item.id}>
              {view.picture && (view.image
                ? <img src={api.mediaFileUrl(view.image, "thumbnail")} alt="" loading="lazy" />
                : <div className="card-no-cover">без изображения</div>)}
              <div className="kind">{item.type_title ?? item.type}</div>
              <div className="title">{view.mark && <SourceMark />}{item.title_ru}</div>
              {view.params.length > 0 && <div className="kind">{view.params.join(", ")}</div>}
              <div className="picker-actions">
                <button type="button" className="ghost" onClick={() => { onInsertCard(entity); mark(key, "вставлена карточкой"); }}>
                  Карточкой
                </button>
                <button type="button" className="ghost" onClick={() => { onInsertMention(entity); mark(key, "вставлена в строку"); }}>
                  В строку
                </button>
                {entityId && (linked.has(item.id)
                  ? <span className="hint">связана</span>
                  : (
                    <button type="button" className="ghost" onClick={() => setLinking({ id: item.id, title: item.title_ru })}>
                      Связать
                    </button>
                  ))}
              </div>
              {done[key] && <div className="save-mark ok">{done[key]}</div>}
            </div>
          );
        })}
      </div>
      {cursor && scope === "all" && (
        <div className="list-count"><button type="button" className="ghost" onClick={more}>Показать ещё</button></div>
      )}

      {linking && entityId && (
        <LinkDialog
          fromEntityId={entityId}
          toEntityId={linking.id}
          toTitle={linking.title}
          onLinked={reloadLinks}
          onClose={() => setLinking(null)}
        />
      )}
    </>
  );
}

function MediaTab({ entityId, attached, onInsertMedia, onChanged, done, mark }: TabProps) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("");
  const [scope, setScope] = useState<"" | "yes" | "no">("");
  const [needy, setNeedy] = useState(false);
  const [kinds, setKinds] = useState<{ code: string; title_ru: string }[]>([]);
  const [items, setItems] = useState<MediaAsset[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ id: string; message: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  // Прикреплённые в этом окне — чтобы кнопка сменилась сразу, не дожидаясь
  // перечитывания карточки.
  const [attachedNow, setAttachedNow] = useState<Set<string>>(new Set());

  useEffect(() => {
    api.capabilities()
      .then((caps) => setKinds(caps.dictionaries?.media_kinds ?? []))
      .catch(() => setKinds([]));
  }, []);

  const params = () => ({
    q: query.trim() || undefined,
    kind: kind || undefined,
    attached: scope || undefined,
    entityId: entityId ?? undefined,
    needsAttribution: needy,
  });

  useEffect(() => {
    setLoading(true);
    const timer = setTimeout(() => {
      api.media(params())
        .then((page) => {
          setItems(page.items);
          setCursor(page.next_cursor);
        })
        .catch(() => setItems([]))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [query, kind, scope, needy, entityId, reload]);

  const more = () => {
    if (!cursor) return;
    api.media({ ...params(), cursor })
      .then((page) => {
        setItems((current) => [...current, ...page.items]);
        setCursor(page.next_cursor);
      })
      .catch(() => {});
  };

  const isAttached = (id: string) => attachedNow.has(id) || attached.some((item) => item.asset_id === id);

  const attach = async (asset: MediaAsset) => {
    if (!entityId) return;
    setFailed(null);
    setBusy(asset.id);
    try {
      await api.attachMedia({ entity_id: entityId, asset_id: asset.id, role: "gallery" });
      setAttachedNow((current) => new Set(current).add(asset.id));
      mark(`m${asset.id}`, "прикреплено");
      onChanged();
    } catch (e) {
      setFailed({ id: asset.id, message: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const kindTitle = (code: string | null | undefined) => kinds.find((item) => item.code === code)?.title_ru ?? "";

  return (
    <>
      <div className="filters picker-filters">
        <input autoFocus placeholder="Поиск по подписи, автору, меткам" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">Все виды</option>
          {kinds.map((item) => <option key={item.code} value={item.code}>{item.title_ru}</option>)}
        </select>
        <select value={scope} onChange={(e) => setScope(e.target.value as "" | "yes" | "no")} disabled={!entityId}>
          <option value="">Все изображения</option>
          <option value="yes">Прикреплённые к этой записи</option>
          <option value="no">Не прикреплённые к ней</option>
        </select>
        <label className="check">
          <input type="checkbox" checked={needy} onChange={(e) => setNeedy(e.target.checked)} />
          ждут автора и источника
        </label>
        <button type="button" className="ghost" onClick={() => setUploading(true)}>Загрузить файл</button>
      </div>
      <p className="hint">
        «В текст» — изображение блоком в месте курсора. «Прикрепить» — в галерею карточки.
        {!entityId && " Прикреплять можно после первого сохранения записи."}
      </p>

      {loading && items.length === 0 && <p className="notice">Загружаем…</p>}
      {!loading && items.length === 0 && <p className="notice">Ничего не нашлось.</p>}
      <div className="grid picker-grid">
        {items.map((asset) => {
          const key = `m${asset.id}`;
          const on = isAttached(asset.id);
          return (
            <div className="card" key={asset.id}>
              <img src={api.mediaFileUrl(asset.id, "thumbnail")} alt="" loading="lazy" />
              <div className="kind">{[kindTitle(asset.kind), asset.author].filter(Boolean).join(" · ")}</div>
              <div className="title picker-caption">{asset.caption_ru ?? "без подписи"}</div>
              <div className="picker-actions">
                <button type="button" className="ghost" onClick={() => { onInsertMedia(asset); mark(key, "вставлено в текст"); }}>
                  В текст
                </button>
                {on
                  ? <span className="hint">прикреплено</span>
                  : (
                    <button
                      type="button"
                      className="ghost"
                      disabled={!entityId || busy === asset.id}
                      title={entityId ? undefined : "Сначала сохраните запись"}
                      onClick={() => attach(asset)}
                    >
                      {busy === asset.id ? "Прикрепляем…" : "Прикрепить"}
                    </button>
                  )}
              </div>
              {failed?.id === asset.id && <div className="field-error">{failed.message}</div>}
              {done[key] && <div className="save-mark ok">{done[key]}</div>}
            </div>
          );
        })}
      </div>
      {cursor && (
        <div className="list-count"><button type="button" className="ghost" onClick={more}>Показать ещё</button></div>
      )}

      {uploading && (
        <MediaDialog
          entityId={entityId}
          onSaved={() => {
            setReload((n) => n + 1);
            onChanged();
          }}
          onClose={() => setUploading(false)}
        />
      )}
    </>
  );
}
