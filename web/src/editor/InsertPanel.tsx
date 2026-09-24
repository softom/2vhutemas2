/**
 * Панель справа от текста: откуда берут то, что вставляют в текст.
 *
 * Разделов два, потому что в текст вставляются две вещи: записи и файлы.
 * Места переехали в показатели ([Р-40]) и в тексте не появляются, источники
 * пока прикрепляются к связям, а не вставляются.
 *
 * Записи ищутся по всему дереву; быстрый отбор по ветви заменяет прежнее
 * деление на «объекты» и прочее: объект — это запись ветви «Что» (Р-37).
 */
import { useState } from "react";
import type { EntityType, MediaAsset } from "../api";
import type { InsertableEntity } from "./entityBlocks";
import { EntityPanel } from "./EntityPanel";
import { MediaPanel } from "./MediaPanel";

interface Props {
  entityId: number | null;
  types: EntityType[];
  attached: {
    attachment_id: number;
    asset_id: string;
    caption: string | null;
    role_title: string;
  }[];
  onInsertCard: (entity: InsertableEntity) => void;
  onInsertMention: (entity: InsertableEntity) => void;
  onInsertMedia: (asset: MediaAsset) => void;
  onChanged: () => void;
}

export function InsertPanel(props: Props) {
  const [tab, setTab] = useState<"entities" | "media">("entities");

  return (
    <aside className="entity-panel">
      <div className="panel-tabs">
        <button
          type="button"
          className={tab === "entities" ? "active" : "ghost"}
          onClick={() => setTab("entities")}
        >
          Записи
        </button>
        <button
          type="button"
          className={tab === "media" ? "active" : "ghost"}
          onClick={() => setTab("media")}
        >
          Файлы
        </button>
      </div>

      {tab === "entities"
        ? (
          <EntityPanel
            entityId={props.entityId}
            types={props.types}
            onInsertCard={props.onInsertCard}
            onInsertMention={props.onInsertMention}
          />
        )
        : (
          <MediaPanel
            entityId={props.entityId}
            attached={props.attached}
            onInsert={props.onInsertMedia}
            onChanged={props.onChanged}
          />
        )}
    </aside>
  );
}
