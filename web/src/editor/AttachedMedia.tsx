/**
 * Прикреплённые изображения записи: показ в заданном порядке и перестановка
 * перетаскиванием за «хваталку».
 *
 * Порядок хранится в самой привязке (`sort_order`), а не в файле: один и тот же
 * файл может стоять по-разному в разных карточках. Первое по порядку —
 * обложка в каталоге ([Р-36]), поэтому перестановка и есть выбор обложки.
 */
import { useEffect, useState } from "react";
import { api } from "../api";

export interface AttachedItem {
  attachment_id: number;
  asset_id: string;
  caption: string | null;
  role_title: string;
}

interface Props {
  entityId: number | null;
  items: AttachedItem[];
  onInsert: (item: AttachedItem) => void;
  onChanged: () => void;
}

export function AttachedMedia({ entityId, items, onInsert, onChanged }: Props) {
  const [order, setOrder] = useState<AttachedItem[]>(items);
  const [dragged, setDragged] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setOrder(items), [items]);

  const move = async (from: number, to: number) => {
    if (from === to) return;
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setOrder(next);  // сразу показываем новый порядок, не дожидаясь сервера
    if (!entityId) return;
    try {
      await api.orderMedia(entityId, next.map((item) => item.attachment_id));
      onChanged();
    } catch (e) {
      setError((e as Error).message);
      setOrder(items);
    }
  };

  if (order.length === 0) {
    return (
      <div className="block">
        <h3>Изображения</h3>
        <p className="hint">
          Файлы прикрепляются в панели справа: найдите нужный и нажмите «Прикрепить».
        </p>
      </div>
    );
  }

  return (
    <div className="block">
      <h3>Изображения</h3>
      <p className="hint">
        Порядок задаёте вы: перетащите за «хваталку». Первое изображение
        становится обложкой записи в каталоге.
      </p>
      {error && <p className="error">{error}</p>}
      <ul className="attached-media">
        {order.map((item, index) => (
          <li
            key={item.attachment_id}
            className={[
              index === 0 ? "cover" : "",
              over === index ? "drop-target" : "",
            ].filter(Boolean).join(" ") || undefined}
            onDragOver={(event) => {
              if (dragged === null) return;
              event.preventDefault();
              setOver(index);
            }}
            onDragLeave={() => setOver((current) => (current === index ? null : current))}
            onDrop={(event) => {
              event.preventDefault();
              setOver(null);
              if (dragged !== null) move(dragged, index);
              setDragged(null);
            }}
          >
            <div className="media-row">
              <span
                className="drag-handle"
                title="Перетащите, чтобы изменить порядок"
                draggable
                onDragStart={(event) => {
                  setDragged(index);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", String(item.attachment_id));
                }}
                onDragEnd={() => {
                  setDragged(null);
                  setOver(null);
                }}
              >
                ⠿
              </span>
              <span className="order-number">{index + 1}</span>
            </div>
            <button type="button" className="panel-item-main linklike" onClick={() => onInsert(item)}>
              <img
                className="attached-thumb"
                src={api.mediaFileUrl(item.asset_id, "thumbnail")}
                alt={item.caption ?? ""}
              />
              <span className="panel-item-title">{item.caption ?? "без подписи"}</span>
              <span className="panel-item-sub">
                {index === 0 ? "обложка" : item.role_title}
              </span>
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
        ))}
      </ul>
    </div>
  );
}
