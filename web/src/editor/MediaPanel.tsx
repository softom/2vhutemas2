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
  // Ошибка прикрепления показывается у той плитки, где нажимали (Р-51):
  // общая строка вверху панели оставалась за краем прокрученного списка.
  const [failed, setFailed] = useState<{ id: string; message: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = (q: string) =>
    api.media({ q: q || undefined })
      .then((page) => setItems(page.items))
      .catch(() => setItems([]));

  useEffect(() => {
    const timer = setTimeout(() => load(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const attach = async (asset: MediaAsset) => {
    if (!entityId) return;
    setFailed(null);
    setBusy(asset.id);
    try {
      await api.attachMedia({ entity_id: entityId, asset_id: asset.id, role: "gallery" });
      onChanged();
    } catch (e) {
      setFailed({ id: asset.id, message: (e as Error).message });
    } finally {
      setBusy(null);
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
          {/* Прикрепление — связь записи с изображением, а у несохранённой
              записи ещё нет номера: связывать не с чем. */}
          <button
            type="button"
            className="ghost"
            disabled={!entityId || busy === asset.id}
            title={entityId ? undefined : "Сначала сохраните запись"}
            onClick={() => attach(asset)}
          >
            {busy === asset.id ? "Прикрепляем…" : "Прикрепить"}
          </button>
          {!entityId && <span className="hint">сначала сохраните запись</span>}
          {failed?.id === asset.id && <span className="field-error">{failed.message}</span>}
        </div>
      )}
    </li>
  );

  const attachedIds = new Set(attached.map((item) => item.asset_id));

  return (
    <div>
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button type="button" className="ghost" onClick={() => setUploading(true)}>
          Загрузить файл
        </button>
      </div>
      <p className="hint">
        Перетащите файл в текст или щёлкните по нему. «Прикрепить» добавляет файл в карточку объекта.
      </p>
      {!entityId && (
        <p className="notice">Прикреплять можно после первого сохранения записи: вставлять в текст — уже сейчас.</p>
      )}

      <input
        placeholder="Поиск по медиатеке"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />


      <h4>Медиатека</h4>
      {items.length === 0 && <p className="hint">Ничего не нашлось.</p>}
      <ul className="panel-list media-list">
        {items.filter((asset) => !attachedIds.has(asset.id)).map((asset) => tile(asset, false))}
      </ul>

      {uploading && (
        <MediaDialog
          entityId={entityId}
          onSaved={() => {
            load(query.trim());
            onChanged();
          }}
          onClose={() => setUploading(false)}
        />
      )}
    </div>
  );
}
