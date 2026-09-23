/**
 * Панель файлов справа от текста: поиск, прикрепление, создание, вставка.
 *
 * Файл можно прикрепить к объекту (тогда он появится в карточке) и вставить
 * в текст — перетаскиванием или щелчком. В тексте остаётся ссылка на файл
 * по идентификатору, а не копия.
 */
import { useEffect, useState } from "react";
import { api, type MediaAsset } from "../api";
import { MediaDialog } from "./MediaDialog";

interface Props {
  entityId: number | null;
  attached: { attachment_id: number; asset_id: string; caption: string | null; role_title: string }[];
  onInsert: (asset: MediaAsset) => void;
  onChanged: () => void;
}

export function MediaPanel({ entityId, attached, onInsert, onChanged }: Props) {
  const [items, setItems] = useState<MediaAsset[]>([]);
  const [query, setQuery] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = (q: string) =>
    api.media({ q: q || undefined })
      .then((page) => setItems(page.items))
      .catch(() => setItems([]));

  useEffect(() => {
    const timer = setTimeout(() => load(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const attach = async (asset: MediaAsset) => {
    if (!entityId) {
      setError("Сначала сохраните объект");
      return;
    }
    setError(null);
    try {
      await api.attachMedia({ entity_id: entityId, asset_id: asset.id, role: "gallery" });
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const tile = (asset: MediaAsset, isAttached: boolean) => (
    <li
      key={asset.id}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("application/x-2vhutemas-media", JSON.stringify(asset));
        event.dataTransfer.setData("text/plain", asset.caption_ru ?? "");
      }}
    >
      <button type="button" className="panel-item-main linklike" onClick={() => onInsert(asset)}>
        <img
          className="panel-thumb"
          src={api.mediaFileUrl(asset.id, "thumbnail")}
          alt={asset.caption_ru ?? ""}
        />
        <span className="panel-item-title">{asset.caption_ru ?? "без подписи"}</span>
        <span className="panel-item-sub">
          {isAttached ? "прикреплён к объекту" : "щелчок — вставить в текст"}
        </span>
      </button>
      {!isAttached && (
        <div className="panel-item-actions">
          <button type="button" className="ghost" onClick={() => attach(asset)}>Прикрепить</button>
        </div>
      )}
    </li>
  );

  const attachedIds = new Set(attached.map((item) => item.asset_id));

  return (
    <aside className="entity-panel">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <h3>Файлы</h3>
        <button type="button" className="ghost" onClick={() => setUploading(true)}>Создать</button>
      </div>
      <p className="hint">
        Перетащите файл в текст или щёлкните по нему. «Прикрепить» добавляет файл в карточку объекта.
      </p>

      <input
        placeholder="Поиск по медиатеке"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {error && <p className="error">{error}</p>}

      {attached.length > 0 && (
        <>
          <h4>Прикреплённые</h4>
          <ul className="panel-list media-list">
            {attached.map((item) => {
              const asset = items.find((candidate) => candidate.id === item.asset_id);
              return (
                <li key={item.attachment_id}>
                  <button
                    type="button"
                    className="panel-item-main linklike"
                    onClick={() =>
                      onInsert(
                        asset ??
                          ({ id: item.asset_id, caption_ru: item.caption } as MediaAsset),
                      )}
                  >
                    <img
                      className="panel-thumb"
                      src={api.mediaFileUrl(item.asset_id, "thumbnail")}
                      alt={item.caption ?? ""}
                    />
                    <span className="panel-item-title">{item.caption ?? "без подписи"}</span>
                    <span className="panel-item-sub">{item.role_title}</span>
                  </button>
                  <div className="panel-item-actions">
                    <button
                      type="button"
                      className="ghost"
                      onClick={async () => {
                        await api.detachMedia(item.attachment_id);
                        onChanged();
                      }}
                    >
                      Открепить
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <h4>Медиатека</h4>
      {items.length === 0 && <p className="hint">Ничего не нашлось.</p>}
      <ul className="panel-list media-list">
        {items.filter((asset) => !attachedIds.has(asset.id)).map((asset) => tile(asset, false))}
      </ul>

      {uploading && (
        <MediaDialog
          onSaved={() => {
            load(query.trim());
            onChanged();
          }}
          onClose={() => setUploading(false)}
        />
      )}
    </aside>
  );
}
