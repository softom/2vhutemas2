/**
 * Просмотр изображений карточки: одно изображение во весь экран и переход
 * к следующему по порядку прикрепления — по кругу.
 *
 * Порядок здесь тот же, что в карточке: его задаёт автор перетаскиванием
 * ([Р-34]). Поэтому «следующее» — это следующее по замыслу, а не по дате
 * загрузки и не по имени файла.
 */
import { useEffect } from "react";
import { api } from "../api";

export interface ViewerItem {
  asset_id: string;
  caption?: string | null;
  role_title?: string | null;
}

interface Props {
  items: ViewerItem[];
  index: number;
  onMove: (index: number) => void;
  onClose: () => void;
}

export function MediaViewer({ items, index, onMove, onClose }: Props) {
  const total = items.length;
  const item = items[index];

  // По кругу: с последнего вперёд — на первое, с первого назад — на последнее.
  const step = (delta: number) => onMove((index + delta + total) % total);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") step(1);
      if (event.key === "ArrowLeft") step(-1);
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  });

  if (!item) return null;

  return (
    <div
      className="media-viewer-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="media-viewer">
        <img
          className="media-viewer-image"
          src={api.mediaFileUrl(item.asset_id, "screen")}
          alt={item.caption ?? ""}
        />

        <div className="media-viewer-bar">
          <button
            type="button"
            className="ghost"
            aria-label="Предыдущее изображение"
            disabled={total < 2}
            onClick={() => step(-1)}
          >
            ←
          </button>

          <div className="media-viewer-caption">
            <span>{item.caption || item.role_title || "без подписи"}</span>
            <span className="hint">
              {index + 1} из {total} ·{" "}
              <a
                href={api.mediaFileUrl(item.asset_id, "original")}
                target="_blank"
                rel="noreferrer"
              >
                оригинал
              </a>
            </span>
          </div>

          <button
            type="button"
            className="ghost"
            aria-label="Следующее изображение"
            disabled={total < 2}
            onClick={() => step(1)}
          >
            →
          </button>

          <button type="button" className="ghost" aria-label="Закрыть" onClick={onClose}>
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
