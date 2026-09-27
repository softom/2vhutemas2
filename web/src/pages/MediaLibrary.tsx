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
  // Ссылки на автора и источник — внутренняя задача (Р-68). Показываем её
  // числом и отдельным списком: иначе о ней вспоминают, только когда
  // приходит письмо от правообладателя.
  const [needy, setNeedy] = useState(0);
  const [onlyNeedy, setOnlyNeedy] = useState(false);

  const reload = () =>
    api.media({ needsAttribution: onlyNeedy })
      .then((page) => {
        setItems(page.items);
        setCursor(page.next_cursor);
        setNeedy(page.needs_attribution);
      })
      .catch((e) => setError(e.message));

  useEffect(() => {
    reload();
  }, [onlyNeedy]);

  const loadMore = () => {
    if (!cursor) return;
    setLoadingMore(true);
    api.media({ cursor, needsAttribution: onlyNeedy })
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

      {needy > 0 && canUpload && (
        <p className="notice">
          Ждут ссылок: {needy}. У этих файлов не указано, кому приписать или откуда взято, —
          изображение показывается, но цитатой ещё не стало.{" "}
          <button type="button" className="linklike" onClick={() => setOnlyNeedy(!onlyNeedy)}>
            {onlyNeedy ? "показать все файлы" : "показать только их"}
          </button>
        </p>
      )}

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
              {asset.needs_attribution && <div className="kind needs-links">нужны ссылки</div>}
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
