/**
 * Раздел «Записи» панели вставки: откуда берут записи для текста.
 *
 * Три источника, в порядке полезности при письме:
 *   1. связанные с этой записью — то, что автор уже обосновал;
 *   2. поиск по каталогу с отбором по ветви дерева;
 *   3. недавние — то, что уже вставляли в этот текст.
 *
 * **Вставка в текст связью не является** (Р-23): в тексте остаётся ссылка
 * на запись и её отображение. Связь — утверждение об отношении двух
 * записей, и она требует обоснования, поэтому у неё отдельная кнопка.
 */
import { useEffect, useState } from "react";
import { api, type EntityListItem, type EntityType } from "../api";
import type { InsertableEntity } from "./entityBlocks";
import { LinkDialog } from "./LinkDialog";

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
  types: EntityType[];
  onInsertCard: (entity: InsertableEntity) => void;
  onInsertMention: (entity: InsertableEntity) => void;
}

export function EntityPanel({ entityId, types, onInsertCard, onInsertMention }: Props) {
  const [linked, setLinked] = useState<LinkedItem[]>([]);
  const [found, setFound] = useState<EntityListItem[]>([]);
  const [query, setQuery] = useState("");
  const [branch, setBranch] = useState("");
  const [recent, setRecent] = useState<InsertableEntity[]>([]);
  const [linking, setLinking] = useState<{ id: number; title: string } | null>(null);

  const roots = types.filter((type) => type.depth === 0);

  const reloadLinks = () => {
    if (!entityId) return;
    api.links(entityId)
      .then((page) => setLinked(page.items as unknown as LinkedItem[]))
      .catch(() => setLinked([]));
  };

  useEffect(reloadLinks, [entityId]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setFound([]);
      return;
    }
    const timer = setTimeout(() => {
      api.entities({ q: query.trim(), type: branch || undefined })
        .then((page) => setFound(page.items.filter((item) => item.id !== entityId)))
        .catch(() => setFound([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [query, branch, entityId]);

  const remember = (entity: InsertableEntity) => {
    setRecent((previous) => [
      entity,
      ...previous.filter((item) => item.id !== entity.id),
    ].slice(0, 8));
  };

  const isLinked = (id: number) => linked.some((item) => item.other_id === id);

  const row = (entity: InsertableEntity, subtitle?: string | null, canLink = true) => (
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
        {canLink && entityId && (
          isLinked(entity.id)
            ? <span className="panel-item-sub">связан</span>
            : (
              <button
                type="button"
                className="ghost"
                title="Связать записи: потребуется объяснить основание"
                onClick={() => setLinking({ id: entity.id, title: entity.title_ru })}
              >
                Связать
              </button>
            )
        )}
      </div>
    </li>
  );

  return (
    <div>
      <p className="hint">
        Вставьте запись в текст: карточкой отдельным блоком или ссылкой внутри строки.
        Запись не копируется — в тексте остаётся ссылка на неё. Это не связь:
        связь утверждает отношение и требует основания.
      </p>

      <input
        placeholder="Поиск по каталогу"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <div className="chips">
        <button
          type="button"
          className={branch === "" ? "chip active" : "chip"}
          onClick={() => setBranch("")}
        >
          Все
        </button>
        {roots.map((root) => (
          <button
            type="button"
            key={root.code}
            className={branch === root.code ? "chip active" : "chip"}
            onClick={() => setBranch(root.code)}
          >
            {root.title_ru}
          </button>
        ))}
      </div>

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
              ? "Связей пока нет. Найдите запись поиском и нажмите «Связать»."
              : "Сохраните запись, чтобы увидеть её связи."}
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
                false,
              )
            )}
          </ul>
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
    </div>
  );
}
