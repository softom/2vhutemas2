/**
 * Панель сбоку от редактора: откуда берут объекты для вставки в текст.
 *
 * Три источника, в порядке полезности при письме:
 *   1. связанные с этим объектом — то, что автор уже обосновал;
 *   2. поиск по каталогу — когда нужен объект из другой части базы;
 *   3. недавние — то, что уже вставляли в этот текст.
 *
 * Вставка щелчком по кнопке. Перетаскивание работает там, где браузер
 * отдаёт позицию курсора под мышью, и не заменяет собой щелчок.
 */
import { useEffect, useState } from "react";
import { api, type EntityListItem } from "../api";
import type { InsertableEntity } from "./entityBlocks";

interface LinkedItem {
  other_id: number;
  other_title: string;
  other_type_title: string | null;
  other_cover_media_id: string | null;
  role: string | null;
  direction: "incoming" | "outgoing";
  justification: string | null;
}

interface Props {
  entityId: number | null;
  onInsertCard: (entity: InsertableEntity) => void;
  onInsertMention: (entity: InsertableEntity) => void;
}

export function EntityPanel({ entityId, onInsertCard, onInsertMention }: Props) {
  const [linked, setLinked] = useState<LinkedItem[]>([]);
  const [found, setFound] = useState<EntityListItem[]>([]);
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<InsertableEntity[]>([]);

  useEffect(() => {
    if (!entityId) return;
    api.links(entityId)
      .then((page) => setLinked(page.items as unknown as LinkedItem[]))
      .catch(() => setLinked([]));
  }, [entityId]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setFound([]);
      return;
    }
    const timer = setTimeout(() => {
      api.entities({ q: query.trim() })
        .then((page) => setFound(page.items.filter((item) => item.id !== entityId)))
        .catch(() => setFound([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [query, entityId]);

  const remember = (entity: InsertableEntity) => {
    setRecent((previous) => [
      entity,
      ...previous.filter((item) => item.id !== entity.id),
    ].slice(0, 8));
  };

  const row = (entity: InsertableEntity, subtitle?: string | null) => (
    <li
      key={`${entity.id}-${subtitle ?? ""}`}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("application/x-2vhutemas-entity", JSON.stringify(entity));
        event.dataTransfer.setData("text/plain", entity.title_ru);
      }}
    >
      <div className="panel-item-main">
        <span className="panel-item-title">{entity.title_ru}</span>
        {subtitle && <span className="panel-item-sub">{subtitle}</span>}
      </div>
      <div className="panel-item-actions">
        <button
          type="button"
          className="ghost"
          title="Вставить карточкой отдельным блоком"
          onClick={() => {
            onInsertCard(entity);
            remember(entity);
          }}
        >
          Карточка
        </button>
        <button
          type="button"
          className="ghost"
          title="Вставить ссылкой внутри строки"
          onClick={() => {
            onInsertMention(entity);
            remember(entity);
          }}
        >
          В строку
        </button>
      </div>
    </li>
  );

  return (
    <aside className="entity-panel">
      <h3>Объекты</h3>
      <p className="hint">
        Вставьте объект в текст: карточкой отдельным блоком или ссылкой внутри строки.
        Объект не копируется — в тексте остаётся ссылка на него.
      </p>

      <input
        placeholder="Поиск по каталогу"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      {found.length > 0 && (
        <>
          <h4>Найдено</h4>
          <ul className="panel-list">
            {found.map((item) =>
              row(
                { id: item.id, title_ru: item.title_ru, kind: item.type_title ?? item.type },
                item.title_en ?? item.type_title ?? item.type,
              )
            )}
          </ul>
        </>
      )}

      {recent.length > 0 && (
        <>
          <h4>Недавние</h4>
          <ul className="panel-list">{recent.map((item) => row(item, "уже вставляли"))}</ul>
        </>
      )}

      <h4>Связанные</h4>
      {linked.length === 0
        ? (
          <p className="hint">
            {entityId
              ? "Связей пока нет. Свяжите объекты на карточке — связь требует обоснования."
              : "Сохраните объект, чтобы увидеть его связи."}
          </p>
        )
        : (
          <ul className="panel-list">
            {linked.map((item) =>
              row(
                {
                  id: item.other_id,
                  title_ru: item.other_title,
                  kind: item.other_type_title ?? "",
                  cover_media_id: item.other_cover_media_id,
                },
                item.role ?? (item.direction === "outgoing" ? "связан" : "ссылается сюда"),
              )
            )}
          </ul>
        )}
    </aside>
  );
}
