/** Карточка объекта: свойства, датировки, описание и медиа. */
import { Component, type ReactNode, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import type { PartialBlock } from "@blocknote/core";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { api, type EntityCard, type Indicator, placeLabel } from "../api";
import { MediaViewer, type ViewerItem } from "../ui/MediaViewer";
import { createSchema, withEditableEdges } from "../editor/entityBlocks";

/** Первое место записи: им подписывается карточка сверху. */
function firstPlace(indicators: Indicator[]) {
  for (const indicator of indicators) {
    for (const value of indicator.values) {
      if (value.value_type === "place" && value.place) return value.place;
    }
  }
  return null;
}

export function EntityPage({ canEdit }: { canEdit: boolean }) {
  const { id } = useParams();
  const entityId = Number(id);
  const [entity, setEntity] = useState<EntityCard | null>(null);
  const [blocks, setBlocks] = useState<PartialBlock[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Какое изображение открыто во весь экран; пусто — просмотр закрыт.
  const [viewing, setViewing] = useState<number | null>(null);

  useEffect(() => {
    setViewing(null);
    api.entity(entityId).then(async (card) => {
      setEntity(card);
      const documentId = (card as unknown as { description_document_id?: number })
        .description_document_id;
      if (documentId) {
        const doc = await api.document(documentId);
        setBlocks((doc.body_json as PartialBlock[]) ?? []);
      } else {
        setBlocks([]);
      }
    }).catch((e) => setError(e.message));
  }, [entityId]);

  if (error) return <p className="error">{error}</p>;
  if (!entity || blocks === null) return <p className="notice">Загружаем…</p>;

  const indicators = (entity as unknown as { indicators?: Indicator[] }).indicators ?? [];
  const media = (entity as unknown as {
    media?: { asset_id: string; role: string; role_title?: string; caption?: string | null }[];
  }).media ?? [];
  const tags = (entity as unknown as { tags?: { id: string; title: string }[] }).tags ?? [];

  return (
    <article>
      <h1>{entity.title_ru}</h1>
      <p className="sub">
        {[entity.title_original, entity.title_en, entity.title_la].filter(Boolean).join(" · ")}
      </p>

      <div className="row" style={{ marginBottom: 18 }}>
        <span className="badge">{entity.type_title ?? entity.type}</span>
        <span className="badge">
          {entity.material_status === "published" ? "опубликовано" : "черновик"}
        </span>
        {firstPlace(indicators)?.settlement && (
          <span className="badge">{firstPlace(indicators)?.settlement}</span>
        )}
        {firstPlace(indicators)?.country && (
          <span className="badge">{firstPlace(indicators)?.country}</span>
        )}
        {canEdit && (
          <Link to={`/entities/${entity.id}/edit`}>
            <button type="button" className="ghost">Править</button>
          </Link>
        )}
      </div>

      {tags.length > 0 && (
        <p className="tags-line">
          {tags.map((tag) => <span className="tag-chip" key={tag.id}>#{tag.title}</span>)}
        </p>
      )}

      <Indicators items={indicators} />

      <Relations entityId={entity.id} />

      <h2>Описание</h2>
      {blocks.length === 0
        ? <p className="notice">Описание пока не добавлено.</p>
        : <ReadOnlyDocument blocks={blocks} />}

      {media.length > 0 && (
        <>
          <h2>Изображения</h2>
          <div className="grid">
            {media.map((item, index) => (
              <button
                type="button"
                className="card card-button"
                key={item.asset_id}
                onClick={() => setViewing(index)}
              >
                <img src={api.mediaFileUrl(item.asset_id, "thumbnail")} alt="" />
                <div className="kind">{item.caption ?? item.role}</div>
              </button>
            ))}
          </div>
        </>
      )}

      {viewing !== null && (
        <MediaViewer
          items={media as ViewerItem[]}
          index={viewing}
          onMove={setViewing}
          onClose={() => setViewing(null)}
        />
      )}
    </article>
  );
}

interface LinkRow {
  id: number;
  other_id: number;
  other_title: string;
  other_type_title: string | null;
  role: string | null;
  direction: "incoming" | "outgoing";
  justification: string | null;
}

/** Связи объекта вместе с обоснованиями и упоминания в опубликованных текстах. */
function Relations({ entityId }: { entityId: number }) {
  const [items, setItems] = useState<LinkRow[]>([]);
  const [mentions, setMentions] = useState<Record<string, unknown>[]>([]);

  useEffect(() => {
    api.links(entityId).then((page) => setItems(page.items as unknown as LinkRow[])).catch(() => {});
    api.mentions(entityId).then((page) => setMentions(page.items)).catch(() => {});
  }, [entityId]);

  if (items.length === 0 && mentions.length === 0) return null;
  return (
    <>
      {items.length > 0 && (
        <>
          <h2>Связи</h2>
          <ul className="relations">
            {items.map((item) => (
              <li key={item.id}>
                <Link to={`/entities/${item.other_id}`}>{item.other_title}</Link>
                {item.role && <span className="badge">{item.role}</span>}
                {item.justification && <p className="notice">{item.justification}</p>}
              </li>
            ))}
          </ul>
        </>
      )}
      {mentions.length > 0 && (
        <>
          <h2>Упоминается в материалах</h2>
          <ul>
            {mentions.map((mention, index) => (
              <li key={index}>{String(mention.document_title ?? "Материал")}</li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

/** Величина в человеческом виде: число с единицей, дата, место, да/нет. */
function valueText(value: Indicator["values"][number]): string {
  if (value.num_value !== null && value.num_value !== undefined && value.num_value !== "") {
    return `${value.num_value}${value.unit ? " " + value.unit : ""}`;
  }
  if (value.text_value) return value.text_value;
  if (value.bool_value !== null && value.bool_value !== undefined) {
    return value.bool_value ? "да" : "нет";
  }
  if (value.option) return value.option_title ?? value.option;
  if (value.place) return placeLabel(value.place);
  if (value.date_start_year) {
    const range = value.date_end_year
      ? `${value.date_start_year}–${value.date_end_year}`
      : value.is_ongoing
      ? `с ${value.date_start_year}`
      : String(value.date_start_year);
    return value.is_approximate ? `около ${range}` : range;
  }
  return "";
}

/**
 * Показатели записи (Р-38). Даты и места — такие же величины (Р-39),
 * но у них своё место в карточке: читателю привычнее видеть их отдельно.
 */
function Indicators({ items }: { items: Indicator[] }) {
  const rows = items.flatMap((item) =>
    item.values.map((value) => ({ value, group: item }))
  );
  const places = rows.filter((row) => row.value.value_type === "place");
  const dates = rows.filter((row) => row.value.value_type === "date");
  const rest = items
    .map((item) => ({
      item,
      values: item.values.filter((value) =>
        value.value_type !== "place" && value.value_type !== "date"
      ),
    }))
    .filter((group) => group.values.length > 0);

  if (rows.length === 0) return null;

  return (
    <>
      {rest.length > 0 && (
        <>
          <h2>Показатели</h2>
          {rest.map((group, index) => (
            <div key={group.item.id ?? index}>
              {rest.length > 1 && (
                <h3>
                  {group.item.title}
                  {group.item.measured_year ? ` · ${group.item.measured_year}` : ""}
                  {group.item.is_current ? "" : " · не действующие"}
                </h3>
              )}
              <dl className="facts">
                {group.values.map((value, at) => (
                  <div key={`${value.parameter}-${at}`}>
                    <dt>{value.title ?? value.parameter}</dt>
                    <dd>{valueText(value)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </>
      )}

      {places.length > 0 && (
        <>
          <h2>Места</h2>
          <dl className="facts">
            {places.map((row, index) => (
              <div key={index}>
                <dt>{row.value.title ?? row.value.parameter}</dt>
                <dd>
                  {valueText(row.value)}
                  {row.value.place?.lat !== null && row.value.place?.lat !== undefined && (
                    <span className="notice">
                      {" "}({row.value.place.lat.toFixed(4)}, {row.value.place.lon?.toFixed(4)})
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}

      {dates.length > 0 && (
        <>
          <h2>Датировки</h2>
          <ul>
            {dates.map((row, index) => (
              <li key={index}>
                {row.value.title ?? row.value.parameter}: {valueText(row.value)}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

/**
 * Показ текста: редактор создаётся только после того, как предыдущий снят.
 *
 * При переходе по ссылке с одной карточки на другую оба показа существовали
 * мгновение одновременно, и новый падал с «Position undefined out of range».
 * Обновление страницы ошибку прятало, потому что прежнего показа уже не было.
 */
function ReadOnlyDocument({ blocks }: { blocks: PartialBlock[] }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setReady(true));
    return () => {
      cancelAnimationFrame(frame);
      setReady(false);
    };
  }, [blocks]);

  if (!ready) return <p className="notice">Готовим текст…</p>;
  // Если показ всё же споткнётся, читателю остаётся текст, а не пустая
  // страница с ошибкой: материал важнее оформления.
  return (
    <DocumentBoundary blocks={blocks}>
      <DocumentView blocks={blocks} />
    </DocumentBoundary>
  );
}

/** Простой вид текста: заголовки, абзацы и подписи к изображениям. */
function PlainDocument({ blocks }: { blocks: PartialBlock[] }) {
  const lines = blocks.flatMap((block) => {
    const record = block as unknown as {
      type?: string;
      content?: { text?: string }[];
      props?: { caption?: string };
    };
    if (record.type === "mediaImage") {
      return record.props?.caption ? [record.props.caption] : [];
    }
    const text = (record.content ?? []).map((part) => part.text ?? "").join("").trim();
    return text ? [text] : [];
  });
  return (
    <div className="editor-shell plain-document">
      {lines.map((line, index) => <p key={index}>{line}</p>)}
    </div>
  );
}

class DocumentBoundary extends Component<
  { blocks: PartialBlock[]; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("Показ текста не удался, показываем простым видом", error);
  }

  render() {
    if (this.state.failed) {
      return (
        <>
          <p className="notice">
            Оформление текста показать не удалось — ниже сам текст.
          </p>
          <PlainDocument blocks={this.props.blocks} />
        </>
      );
    }
    return this.props.children;
  }
}

function DocumentView({ blocks }: { blocks: PartialBlock[] }) {
  // Схема та же, что в редакторе: иначе карточка объекта падает на карточке
  // объекта внутри текста и на изображении из медиатеки.
  const schema = useMemo(() => createSchema(), []);
  const editor = useCreateBlockNote({
    schema,
    // Края подбиваются пустым абзацем: текст, заканчивающийся изображением,
    // ронял показ с «Position undefined out of range» (Р-46).
    initialContent: blocks.length ? (withEditableEdges(blocks) as never) : undefined,
  });
  return (
    <div className="editor-shell">
      <BlockNoteView editor={editor} editable={false} theme="light" />
    </div>
  );
}
