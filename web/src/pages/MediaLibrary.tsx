/**
 * Медиатека: список файлов и одно окно на загрузку и правку (правило 15).
 *
 * Щелчок по файлу открывает то же окно, что и загрузка, — в режиме правки.
 */
import { useEffect, useState } from "react";
import { ListCount } from "../ui/ListCount";
import { api, type MediaAsset } from "../api";
import { MediaDialog } from "../editor/MediaDialog";

export function MediaLibrary({ canUpload }: { canUpload: boolean }) {
  const [items, setItems] = useState<MediaAsset[]>([]);
  // Медиатека переросла страницу: без подгрузки файлы за первой двадцаткой
  // были недоступны совсем.
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ open: boolean; asset: MediaAsset | null }>({
    open: false,
    asset: null,
  });

  const reload = () =>
    api.media({})
      .then((page) => {
        setItems(page.items);
        setCursor(page.next_cursor);
      })
      .catch((e) => setError(e.message));

  useEffect(() => {
    reload();
  }, []);

  const loadMore = () => {
    if (!cursor) return;
    setLoadingMore(true);
    api.media({ cursor })
      .then((page) => {
        setItems((current) => [...current, ...page.items]);
        setCursor(page.next_cursor);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoadingMore(false));
  };

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

      {items.length > 0 && (
        <ListCount
          shown={items.length}
          word={["файл", "файла", "файлов"]}
          hasMore={!!cursor}
          onMore={loadMore}
          loading={loadingMore}
        />
      )}

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
    {items.length > 0 && (
        <ListCount
          shown={items.length}
          word={["файл", "файла", "файлов"]}
          hasMore={!!cursor}
          onMore={loadMore}
          loading={loadingMore}
        />
      )}
    </section>
  );
}
