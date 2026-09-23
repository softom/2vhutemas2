/**
 * Медиатека: список файлов и одно окно на загрузку и правку (правило 15).
 *
 * Щелчок по файлу открывает то же окно, что и загрузка, — в режиме правки.
 */
import { useEffect, useState } from "react";
import { api, type MediaAsset } from "../api";
import { MediaDialog } from "../editor/MediaDialog";

export function MediaLibrary({ canUpload }: { canUpload: boolean }) {
  const [items, setItems] = useState<MediaAsset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ open: boolean; asset: MediaAsset | null }>({
    open: false,
    asset: null,
  });

  const reload = () =>
    api.media({}).then((page) => setItems(page.items)).catch((e) => setError(e.message));

  useEffect(() => {
    reload();
  }, []);

  return (
    <section>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <h1>Медиатека</h1>
        {canUpload && (
          <button type="button" onClick={() => setDialog({ open: true, asset: null })}>
            Загрузить файл
          </button>
        )}
      </div>
      <p className="sub">
        Оригинал хранится неизменным, экранная версия и превью создаются сразу.
        Щелчок по файлу открывает его сведения.
      </p>

      {error && <p className="error">{error}</p>}
      {items.length === 0 && <p className="notice">Файлов пока нет.</p>}

      <div className="grid">
        {items.map((asset) => {
          const thumb = asset.files?.thumbnail;
          const extra = asset as unknown as {
            kind?: string;
            author?: string;
            holder?: string;
            created_year?: number;
          };
          return (
            <button
              type="button"
              className="card"
              key={asset.id}
              onClick={() => setDialog({ open: true, asset })}
              style={{ textAlign: "left", background: "var(--surface)", color: "inherit" }}
            >
              {thumb?.status === "ready"
                ? <img src={api.mediaFileUrl(asset.id, "thumbnail")} alt={asset.caption_ru ?? ""} />
                : <div className="notice" style={{ height: 150 }}>обработка…</div>}
              <div className="title" style={{ fontSize: 15 }}>
                {asset.caption_ru ?? "без подписи"}
              </div>
              <div className="kind">
                {[extra.kind, extra.created_year, extra.author, extra.holder]
                  .filter(Boolean).join(" · ") || asset.asset_class}
              </div>
            </button>
          );
        })}
      </div>

      {dialog.open && (
        <MediaDialog
          asset={dialog.asset}
          onSaved={reload}
          onClose={() => setDialog({ open: false, asset: null })}
        />
      )}
    </section>
  );
}
