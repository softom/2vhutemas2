/**
 * Собственные элементы редактора: карточка объекта и упоминание в строке.
 *
 * В документе хранится только идентификатор сущности и идентификатор самого
 * появления. Объект не копируется: один и тот же объект может встречаться
 * в разных текстах и несколько раз в одном, а правка карточки объекта
 * не требует правки текстов.
 */
import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs } from "@blocknote/core";
import { createReactBlockSpec, createReactInlineContentSpec } from "@blocknote/react";
import { api } from "../api";

/** Блок-карточка: занимает строку и двигается вместе с остальными блоками. */
export const EntityCardBlock = createReactBlockSpec(
  {
    type: "entityCard",
    propSchema: {
      entityId: { default: "" },
      occurrenceId: { default: "" },
      title: { default: "" },
      kind: { default: "" },
      mediaAssetId: { default: "" },
      note: { default: "" },
    },
    content: "none",
  },
  {
    render: ({ block }) => {
      const props = block.props as Record<string, string>;
      const href = `/new/entities/${props.entityId}`;
      return (
        <div className="entity-card" contentEditable={false}>
          {props.mediaAssetId
            ? <img src={api.mediaFileUrl(props.mediaAssetId, "thumbnail")} alt="" />
            : null}
          <div>
            <a href={href}>{props.title || `Объект ${props.entityId}`}</a>
            <div className="entity-card-kind">{props.kind}</div>
            {props.note ? <div className="entity-card-note">{props.note}</div> : null}
          </div>
        </div>
      );
    },
  },
);

/** Упоминание: ссылка внутри абзаца, «здание [НОВАТ] перестроено». */
export const EntityMention = createReactInlineContentSpec(
  {
    type: "entityMention",
    propSchema: {
      entityId: { default: "" },
      occurrenceId: { default: "" },
      title: { default: "" },
    },
    content: "none",
  },
  {
    render: ({ inlineContent }) => {
      const props = inlineContent.props as Record<string, string>;
      return (
        <a className="entity-mention" href={`/new/entities/${props.entityId}`}>
          {props.title || `объект ${props.entityId}`}
        </a>
      );
    },
  },
);

/**
 * Изображение из медиатеки: в документе хранится идентификатор файла,
 * а не адрес. Адрес доставки вычисляется при показе — так приватность
 * и замена вариантов остаются на стороне сервера.
 */
export const MediaImageBlock = createReactBlockSpec(
  {
    type: "mediaImage",
    propSchema: {
      assetId: { default: "" },
      caption: { default: "" },
      variant: { default: "screen" },
    },
    content: "none",
  },
  {
    render: ({ block }) => {
      const props = block.props as Record<string, string>;
      return (
        <figure className="media-figure" contentEditable={false}>
          <img
            src={api.mediaFileUrl(props.assetId, (props.variant as "screen") || "screen")}
            alt={props.caption}
          />
          {props.caption ? <figcaption>{props.caption}</figcaption> : null}
        </figure>
      );
    },
  },
);

export const schema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    entityCard: EntityCardBlock,
    mediaImage: MediaImageBlock,
  },
  inlineContentSpecs: { ...defaultInlineContentSpecs, entityMention: EntityMention },
});

export type AppSchema = typeof schema;

export interface InsertableEntity {
  id: number;
  title_ru: string;
  kind: string;
  cover_media_id?: string | null;
}

/** Вставка карточки объекта в место курсора. */
// deno-lint-ignore no-explicit-any
export function insertEntityCard(editor: any, entity: InsertableEntity, note?: string) {
  editor.insertBlocks(
    [{
      type: "entityCard",
      props: {
        entityId: String(entity.id),
        occurrenceId: crypto.randomUUID(),
        title: entity.title_ru,
        kind: entity.kind,
        mediaAssetId: entity.cover_media_id ?? "",
        note: note ?? "",
      },
    }],
    editor.getTextCursorPosition().block,
    "after",
  );
}

/** Вставка изображения из медиатеки в место курсора. */
// deno-lint-ignore no-explicit-any
export function insertMediaImage(editor: any, asset: { id: string; caption_ru?: string | null }) {
  editor.insertBlocks(
    [{
      type: "mediaImage",
      props: { assetId: asset.id, caption: asset.caption_ru ?? "", variant: "screen" },
    }],
    editor.getTextCursorPosition().block,
    "after",
  );
}

/** Вставка упоминания в текущую строку. */
// deno-lint-ignore no-explicit-any
export function insertEntityMention(editor: any, entity: InsertableEntity) {
  editor.insertInlineContent([
    {
      type: "entityMention",
      props: {
        entityId: String(entity.id),
        occurrenceId: crypto.randomUUID(),
        title: entity.title_ru,
      },
    },
    " ",
  ]);
}
