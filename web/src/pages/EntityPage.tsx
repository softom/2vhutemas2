/** Карточка объекта: свойства, датировки, описание и медиа. */
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import type { PartialBlock } from "@blocknote/core";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { api, type EntityCard } from "../api";

interface DateRow {
  kind: string;
  title: string;
  start_year: number;
  end_year: number | null;
  is_approximate: boolean;
  is_ongoing: boolean;
}

export function EntityPage({ canEdit }: { canEdit: boolean }) {
  const { id } = useParams();
  const entityId = Number(id);
  const [entity, setEntity] = useState<EntityCard | null>(null);
  const [blocks, setBlocks] = useState<PartialBlock[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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

  const profile = entity.profile as Record<string, string | null>;
  const media = (entity as unknown as { media?: { asset_id: string; role: string }[] }).media ?? [];
  const dates = (entity as unknown as { dates?: DateRow[] }).dates ?? [];

  return (
    <article>
      <h1>{entity.title_ru}</h1>
      <p className="sub">
        {[entity.title_original, entity.title_en, entity.title_la].filter(Boolean).join(" · ")}
      </p>

      <div className="row" style={{ marginBottom: 18 }}>
        <span className="badge">{entity.kind}</span>
        <span className="badge">
          {entity.material_status === "published" ? "опубликовано" : "черновик"}
        </span>
        {profile?.city && <span className="badge">{profile.city}</span>}
        {profile?.country && <span className="badge">{profile.country}</span>}
        {canEdit && (
          <Link to={`/entities/${entity.id}/edit`}>
            <button type="button" className="ghost">Править</button>
          </Link>
        )}
      </div>

      <Facts profile={profile} />

      {dates.length > 0 && (
        <>
          <h2>Датировки</h2>
          <ul>
            {dates.map((d, index) => (
              <li key={index}>
                {d.title}: {d.is_approximate ? "около " : ""}{d.start_year}
                {d.end_year ? `—${d.end_year}` : d.is_ongoing ? " — по настоящее время" : ""}
              </li>
            ))}
          </ul>
        </>
      )}

      <h2>Описание</h2>
      {blocks.length === 0
        ? <p className="notice">Описание пока не добавлено.</p>
        : <ReadOnlyDocument blocks={blocks} />}

      {media.length > 0 && (
        <>
          <h2>Изображения</h2>
          <div className="grid">
            {media.map((item) => (
              <a
                className="card"
                key={item.asset_id}
                href={api.mediaFileUrl(item.asset_id, "screen")}
                target="_blank"
                rel="noreferrer"
              >
                <img src={api.mediaFileUrl(item.asset_id, "thumbnail")} alt="" />
                <div className="kind">{item.role}</div>
              </a>
            ))}
          </div>
        </>
      )}
    </article>
  );
}

const FACT_LABELS: [string, string, string?][] = [
  ["status", "Сохранность"],
  ["typology", "Типология"],
  ["address", "Адрес"],
  ["current_use", "Использование"],
  ["materials", "Материалы"],
  ["floors", "Этажей"],
  ["height_m", "Высота", "м"],
  ["area_sq_m", "Площадь", "м²"],
  ["capacity", "Вместимость"],
  ["heritage_status", "Охранный статус"],
  ["known_for", "Чем известен"],
  ["website_url", "Сайт"],
];

/** Сведения карточки: показываем только заполненное, пустое не выдумываем. */
function Facts({ profile }: { profile: Record<string, unknown> }) {
  const rows = FACT_LABELS
    .map(([key, label, unit]) => ({ key, label, unit, value: profile?.[key] }))
    .filter((row) => row.value !== null && row.value !== undefined && row.value !== "");
  if (rows.length === 0) return null;
  return (
    <>
      <h2>Сведения</h2>
      <dl className="facts">
        {rows.map((row) => (
          <div key={row.key}>
            <dt>{row.label}</dt>
            <dd>{String(row.value)}{row.unit ? ` ${row.unit}` : ""}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

function ReadOnlyDocument({ blocks }: { blocks: PartialBlock[] }) {
  const editor = useCreateBlockNote({ initialContent: blocks.length ? blocks : undefined });
  return (
    <div className="editor-shell">
      <BlockNoteView editor={editor} editable={false} theme="light" />
    </div>
  );
}
