/** Медиатека: загрузка оригинала и состояние производных. */
import { useEffect, useRef, useState } from "react";
import { api, type MediaAsset } from "../api";

export function MediaLibrary({ canUpload }: { canUpload: boolean }) {
  const [items, setItems] = useState<MediaAsset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const reload = () =>
    api.media().then((page) => setItems(page.items)).catch((e) => setError(e.message));

  useEffect(() => { reload(); }, []);

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("caption", file.name);
      await api.uploadMedia(form);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  return (
    <section>
      <h1>Медиатека</h1>
      <p className="sub">Оригинал сохраняется неизменным, экранная версия и превью создаются сразу.</p>

      {canUpload && (
        <div className="filters">
          <input
            ref={fileInput}
            type="file"
            disabled={busy}
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
          />
          {busy && <span className="notice">Загружаем и обрабатываем…</span>}
        </div>
      )}

      {error && <p className="error">{error}</p>}
      {items.length === 0 && <p className="notice">Файлов пока нет.</p>}

      <div className="grid">
        {items.map((asset) => {
          const thumb = asset.files?.thumbnail;
          return (
            <a
              className="card"
              key={asset.id}
              href={api.mediaFileUrl(asset.id, "screen")}
              target="_blank"
              rel="noreferrer"
            >
              {thumb?.status === "ready"
                ? <img src={api.mediaFileUrl(asset.id, "thumbnail")} alt={asset.caption_ru ?? ""} />
                : <div className="notice" style={{ height: 150 }}>обработка…</div>}
              <div className="title" style={{ fontSize: 15 }}>{asset.caption_ru ?? "без подписи"}</div>
              <div className="kind">
                {asset.asset_class} · {asset.visibility === "public" ? "публичный" : "приватный"}
              </div>
            </a>
          );
        })}
      </div>
    </section>
  );
}
