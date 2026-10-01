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
import {
  BlockNoteSchema,
  createInlineContentSpec,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
} from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";
import { api, type CompactItem, compactParts, compactPicture } from "../api";

/**
 * Название, тип и компактный вид записи берутся у самой записи, а не
 * хранятся в документе: обложка — первое изображение записи (Р-36), вид —
 * настройка её типа (таблица отображений), и копия в тексте завела бы им
 * второй источник. Ответы запоминаем, чтобы десяток карточек в лекции не
 * превращался в десяток одинаковых запросов.
 */
const cardCache = new Map<string, { title: string; kind: string; compact: CompactItem[] }>();

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
    // Ссылки в старых текстах написаны с прежним путём /new — снимаем его,
    // чтобы переход остался внутри приложения (Р-59).
    navigate(href.replace(/^\/new/, ""));
  };
}

type CardInfo = { title: string; kind: string; compact: CompactItem[] };
const cardLoads = new Map<string, Promise<CardInfo>>();

/** Сведения записи для показа в тексте — один запрос на запись за страницу. */
function loadCard(entityId: string): Promise<CardInfo> {
  const known = cardCache.get(entityId);
  if (known) return Promise.resolve(known);
  let pending = cardLoads.get(entityId);
  if (!pending) {
    pending = api.entity(Number(entityId)).then((entity) => {
      const next = {
        title: entity.title_ru,
        kind: entity.type_title ?? entity.type ?? "",
        compact: entity.compact ?? [],
      };
      cardCache.set(entityId, next);
      return next;
    });
    pending.catch(() => cardLoads.delete(entityId));
    cardLoads.set(entityId, pending);
  }
  return pending;
}

/**
 * Переход по вставке в строке. Вставки в строке рисуются обычным DOM, а не
 * React (см. EntityMention), поэтому маршрутизатор им передаётся отсюда:
 * приложение регистрирует его один раз (App.tsx).
 */
let inAppNavigate: ((to: string) => void) | null = null;
export function setInAppNavigate(navigate: ((to: string) => void) | null) {
  inAppNavigate = navigate;
}

function linkInApp(anchor: HTMLAnchorElement, href: string) {
  anchor.href = href;
  anchor.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey) return;
    if (event.button !== 0 || !inAppNavigate) return;
    event.preventDefault();
    inAppNavigate(href.replace(/^\/new/, ""));
  });
}

/** Знак источника строкой разметки — для вставок, нарисованных DOM. */
const SOURCE_MARK_SVG =
  `<svg class="source-mark" viewBox="0 0 16 16" aria-hidden="true" focusable="false">` +
  `<path d="M4.5 2.5H11l2.5 2.5v8.5h-9z" fill="none" stroke="currentColor" stroke-width="1.3"/>` +
  `<path d="M6.3 6.6h4.2M6.3 9h4.2M6.3 11.4h2.6" stroke="currentColor" stroke-width="1.3"/></svg>`;

function useEntityCard(entityId: string, fallback: { title: string; kind: string }) {
  const [card, setCard] = useState(
    cardCache.get(entityId) ?? { ...fallback, compact: [] as CompactItem[] },
  );

  useEffect(() => {
    if (!entityId) return;
    const known = cardCache.get(entityId);
    if (known) {
      setCard(known);
      return;
    }
    let cancelled = false;
    loadCard(entityId)
      .then((next) => {
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
  // Изображение, его форма, знак и значения — по компактному виду типа.
  const view = compactParts(card.compact);
  const cover = compactPicture(view, "screen");
  const href = `/entities/${props.entityId}`;
  const open = useInAppLink(href);

  const shape = view.portrait ? " portrait" : "";
  const kind = [card.kind, ...view.params].filter(Boolean).join(" · ");
  return (
    <div className={cover ? `entity-card with-cover${shape}` : `entity-card${shape}`}>
      {cover && <img src={cover} alt="" />}
      <div className="entity-card-text">
        <a href={href} onClick={open}>{view.mark && <SourceMark />}{card.title}</a>
        <div className="entity-card-kind">{kind}</div>
        {props.note ? <div className="entity-card-note">{props.note}</div> : null}
      </div>
    </div>
  );
}

/**
 * Упоминание: ссылка внутри абзаца, «здание [НОВАТ] перестроено».
 *
 * Рисуется обычным DOM, а не React. BlockNote 0.23 перерисовывает React-узлы
 * порталами, и React-вставка в абзаце сразу за карточкой записи заставляла
 * перерисоваться уже заменённый узел карточки: редактор падал с «Position
 * undefined out of range» (лекция 563). Вид тот же: компактный вид типа —
 * миниатюра, портрет или знак, значения параметров — дорисовывается, когда
 * придут сведения записи.
 */
export const EntityMention = createInlineContentSpec(
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
    render: (inlineContent) => {
      const props = inlineContent.props as Record<string, string>;
      const anchor = document.createElement("a");
      anchor.className = "entity-mention";
      linkInApp(anchor, `/entities/${props.entityId}`);
      const label = document.createTextNode(props.title || `объект ${props.entityId}`);
      anchor.append(label);
      if (props.entityId) {
        loadCard(props.entityId)
          .then((card) => {
            if (!props.title && card.title) label.textContent = card.title;
            const view = compactParts(card.compact);
            const picture = compactPicture(view, "thumbnail");
            if (picture) {
              const img = document.createElement("img");
              img.className = view.portrait ? "mention-thumb portrait" : "mention-thumb";
              img.src = picture;
              img.alt = "";
              anchor.prepend(img);
            } else if (view.mark) {
              anchor.insertAdjacentHTML("afterbegin", SOURCE_MARK_SVG);
            }
            if (view.params.length > 0) {
              const param = document.createElement("span");
              param.className = "compact-param";
              param.textContent = `, ${view.params.join(", ")}`;
              anchor.append(param);
            }
          })
          .catch(() => {});
      }
      return { dom: anchor };
    },
  },
);

/**
 * Ссылка на источник: пиктограмма в строке, ведущая к объекту.
 *
 * Цитируемое — это объект: книга, статья, веб-страница (Р-76). Обстоятельства
 * цитаты — «Камю в статье о Прекрасном, на стр. 34 говорил „…“» — принадлежат
 * не тексту и не объекту, а связи между ними, и хранятся её обоснованием.
 * В тексте стоит только знак: он ведёт к объекту, а подсказка показывает,
 * что именно оттуда взято.
 *
 * Поэтому здесь лежат номер объекта и номер связи, а не адрес и не цитата:
 * адрес принадлежит объекту, цитата — связи, и копия в тексте завела бы им
 * вторых хозяев.
 */
export const SourceRef = createInlineContentSpec(
  {
    type: "sourceRef",
    propSchema: {
      entityId: { default: "" },
      linkId: { default: "" },
      occurrenceId: { default: "" },
      title: { default: "" },
      note: { default: "" },
    },
    content: "none",
  },
  {
    // Обычный DOM, как у упоминания: React-вставка за карточкой роняла
    // редактор (см. EntityMention).
    render: (inlineContent) => {
      const props = inlineContent.props as Record<string, string>;
      const anchor = document.createElement("a");
      anchor.className = "source-ref";
      linkInApp(anchor, `/entities/${props.entityId}`);
      // Подсказка — то самое основание связи: откуда и что взято.
      anchor.title = props.note || props.title || `источник ${props.entityId}`;
      anchor.innerHTML = SOURCE_MARK_SVG;
      return { dom: anchor };
    },
  },
);

/** Знак источника: лист с загнутым углом. Рисуется краской текста, поэтому
 *  одинаково виден на светлом и тёмном. */
export function SourceMark() {
  return (
    <svg className="source-mark" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M4.5 2.5H11l2.5 2.5v8.5h-9z" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M6.3 6.6h4.2M6.3 9h4.2M6.3 11.4h2.6" stroke="currentColor" strokeWidth="1.3" />
    </svg>
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

/**
 * Интерактивная модель из `/models/` (Р-80): в тексте — выделенная рамка
 * с живой моделью. Хранится только адрес страницы модели; чужие адреса
 * не показываются, как и в готовой странице.
 */
export const ModelEmbedBlock = createReactBlockSpec(
  {
    type: "modelEmbed",
    propSchema: {
      src: { default: "" },
      title: { default: "" },
      caption: { default: "" },
      height: { default: "560" },
    },
    content: "none",
  },
  {
    render: ({ block }) => {
      const props = block.props as Record<string, string>;
      const src = /^\/models\/[a-z0-9-]+\.html$/.test(props.src) ? props.src : "";
      const height = Math.min(Math.max(Number(props.height) || 560, 320), 900);
      return (
        <figure className="model-embed">
          <div className="model-embed-label">Интерактивная модель · {props.title || src}</div>
          {src ? <iframe src={`${src}?embed=1`} title={props.title} loading="lazy" style={{ height }} /> : null}
          <figcaption>
            {props.caption ? `${props.caption} · ` : ""}
            {src ? <a href={src} target="_blank" rel="noopener">Открыть на весь экран</a> : "адрес модели не из /models/"}
          </figcaption>
        </figure>
      );
    },
  },
);

/** Цитата из старых документов проекта; сохраняем отдельным блочным типом. */
export const QuoteBlock = createReactBlockSpec(
  { type: "quote", propSchema: {}, content: "inline" },
  {
    render: ({ contentRef }) => <blockquote ref={contentRef} className="entity-quote" />,
    toExternalHTML: ({ contentRef }) => <blockquote ref={contentRef} className="entity-quote" />,
  },
);

/** Схема блоков проекта. Отдельная на каждый показ: общая делает переход
 *  с карточки на карточку падением «Position undefined out of range». */
export function createSchema() {
  return BlockNoteSchema.create({
    blockSpecs: {
      ...defaultBlockSpecs,
      quote: QuoteBlock,
      entityCard: EntityCardBlock,
      mediaImage: MediaImageBlock,
      modelEmbed: ModelEmbedBlock,
    },
    inlineContentSpecs: {
      ...defaultInlineContentSpecs,
      entityMention: EntityMention,
      sourceRef: SourceRef,
    },
  });
}

/** Блоки без собственного текста: курсор внутрь них поставить нельзя. */
const VOID_BLOCKS = new Set(["entityCard", "mediaImage", "modelEmbed"]);

/**
 * Подготовка старых документов к текущей схеме BlockNote.
 * Ранний импорт хранил таблицу без маркера tableContent, а цитата quote
 * осталась отдельным блоком проекта. Эти формы сохраняем при открытии,
 * чтобы читатель и редактор видели исходное содержимое без потерь.
 */
// deno-lint-ignore no-explicit-any
export function prepareEditorBlocks(blocks: any[]): any[] {
  if (!Array.isArray(blocks) || blocks.length === 0) return blocks;
  const normalize = (block: any): any => {
    const result = { ...block };
    if (result.type === "table" && result.content && Array.isArray(result.content.rows) &&
        result.content.type === undefined) {
      result.content = { ...result.content, type: "tableContent" };
    }
    if (Array.isArray(result.children)) result.children = result.children.map(normalize);
    return result;
  };
  const result = blocks.map(normalize);
  const paragraph = () => ({ type: "paragraph", content: [] });
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
