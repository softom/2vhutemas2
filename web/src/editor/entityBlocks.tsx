/**
 * Собственные элементы редактора: карточка объекта и упоминание в строке.
 *
 * В документе хранится только идентификатор сущности и идентификатор самого
 * появления. Объект не копируется: один и тот же объект может встречаться
 * в разных текстах и несколько раз в одном, а правка карточки объекта
 * не требует правки текстов.
 */
import { type MouseEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs } from "@blocknote/core";
import { createReactBlockSpec, createReactInlineContentSpec } from "@blocknote/react";
import { api } from "../api";

/**
 * Обложка и название для карточки в тексте берутся у самой записи, а не
 * хранятся в документе: обложка — это первое прикреплённое изображение
 * ([Р-36]), и держать её копию в тексте значило бы иметь два источника
 * одного сведения. Ответы запоминаем, чтобы десяток карточек в лекции
 * не превращался в десяток одинаковых запросов.
 */
const cardCache = new Map<string, { title: string; kind: string; cover: string | null }>();

/**
 * Переход внутри приложения: полная перезагрузка теряет место в тексте,
 * а лекцию читают подряд и возвращаются в ту же точку. Щелчок с Ctrl или
 * средней кнопкой оставляем браузеру — он откроет в новой вкладке.
 *
 * Переход делаем средствами маршрутизатора: подделка события истории
 * выглядела для него возвратом назад, и страница объекта открывалась
 * не сверху.
 */
function useInAppLink(href: string) {
  const navigate = useNavigate();
  return (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey) return;
    if (event.button !== 0) return;
    event.preventDefault();
    navigate(href.replace(/^\/new/, ""));
  };
}

function useEntityCard(entityId: string, fallback: { title: string; kind: string }) {
  const [card, setCard] = useState(cardCache.get(entityId) ?? { ...fallback, cover: null });

  useEffect(() => {
    if (!entityId) return;
    const known = cardCache.get(entityId);
    if (known) {
      setCard(known);
      return;
    }
    let cancelled = false;
    api.entity(Number(entityId))
      .then((entity) => {
        const media = (entity as unknown as { media?: { asset_id: string }[] }).media ?? [];
        const next = {
          title: entity.title_ru,
          kind: entity.type_title ?? entity.type ?? "",
          cover: media[0]?.asset_id ?? null,
        };
        cardCache.set(entityId, next);
        if (!cancelled) setCard(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [entityId]);

  return card;
}

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
      return <EntityCardView props={props} />;
    },
  },
);

/**
 * Вид карточки в тексте: изображение крупно, поверх него — название
 * и тип записи. Мелкая строчка терялась среди абзацев, а объект в лекции
 * должен читаться как объект.
 */
function EntityCardView({ props }: { props: Record<string, string> }) {
  const card = useEntityCard(props.entityId, {
    title: props.title || `Запись ${props.entityId}`,
    kind: props.kind ?? "",
  });
  const cover = card.cover ?? (props.mediaAssetId || null);
  const href = `/new/entities/${props.entityId}`;
  const open = useInAppLink(href);

  return (
    <div className={cover ? "entity-card with-cover" : "entity-card"}>
      {cover && <img src={api.mediaFileUrl(cover, "screen")} alt="" />}
      <div className="entity-card-text">
        <a href={href} onClick={open}>{card.title}</a>
        <div className="entity-card-kind">{card.kind}</div>
        {props.note ? <div className="entity-card-note">{props.note}</div> : null}
      </div>
    </div>
  );
}

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
      return <EntityMentionView props={props} />;
    },
  },
);

/** Упоминание в строке: переход тоже внутренний. */
function EntityMentionView({ props }: { props: Record<string, string> }) {
  const href = `/new/entities/${props.entityId}`;
  const open = useInAppLink(href);
  return (
    <a className="entity-mention" href={href} onClick={open}>
      {props.title || `объект ${props.entityId}`}
    </a>
  );
}

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
      // Пометку contentEditable={false} здесь ставить нельзя: она ломает
      // расчёт положения блоков, и при трёх и более изображениях подряд
      // страница падает с «Position undefined out of range».
      return (
        <figure className="media-figure">
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

/** Схема блоков проекта. Отдельная на каждый показ: общая делает переход
 *  с карточки на карточку падением «Position undefined out of range». */
export function createSchema() {
  return BlockNoteSchema.create({
    blockSpecs: {
      ...defaultBlockSpecs,
      entityCard: EntityCardBlock,
      mediaImage: MediaImageBlock,
    },
    inlineContentSpecs: { ...defaultInlineContentSpecs, entityMention: EntityMention },
  });
}

export const schema = createSchema();

export type AppSchema = typeof schema;

/** Блоки без собственного текста: курсор внутрь них поставить нельзя. */
const VOID_BLOCKS = new Set(["entityCard", "mediaImage"]);

/**
 * Пустой абзац по краям документа, если с края стоит блок без текста.
 * Иначе после последнего изображения некуда поставить курсор и текст
 * невозможно продолжить. Содержимое от этого не меняется.
 */
// deno-lint-ignore no-explicit-any
export function withEditableEdges(blocks: any[]): any[] {
  if (!Array.isArray(blocks) || blocks.length === 0) return blocks;
  const paragraph = () => ({ type: "paragraph", content: [] });
  const result = [...blocks];
  if (VOID_BLOCKS.has(result[result.length - 1]?.type)) result.push(paragraph());
  if (VOID_BLOCKS.has(result[0]?.type)) result.unshift(paragraph());
  return result;
}

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
