/**
 * Редактор объекта: свойства и описание в BlockNote.
 *
 * Правка отправляется вместе с версией, от которой началась (Р-03):
 * если материал успели изменить, сервер вернёт конфликт и правка не затрётся.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import type { PartialBlock } from "@blocknote/core";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import {
  api,
  ApiError,
  type Capabilities,
  type EntityType,
  type Indicator,
  type SuggestedParameter,
} from "../api";
import { IndicatorsField } from "../editor/IndicatorsField";
import {
  insertEntityCard,
  insertEntityMention,
  insertMediaImage,
  schema,
  withEditableEdges,
} from "../editor/entityBlocks";
import { EntityPanel } from "../editor/EntityPanel";
import { type Tag, TagsField } from "../editor/TagsField";
import { MediaPanel } from "../editor/MediaPanel";

interface Props {
  mode: "create" | "edit";
}

/**
 * Адрес страницы из названия: пользователь не должен придумывать его сам.
 * Правило простое — кириллица переводится в латиницу, остальное в дефисы.
 */
const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i",
  й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
  у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "",
  э: "e", ю: "yu", я: "ya",
};

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .split("")
    .map((char) => (char in TRANSLIT ? TRANSLIT[char] : char))
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function EntityEditor({ mode }: Props) {
  const params = useParams();
  const navigate = useNavigate();
  const entityId = params.id ? Number(params.id) : null;

  const [types, setTypes] = useState<EntityType[]>([]);
  const [form, setForm] = useState({
    type: "what",
    slug: "",
    title_ru: "",
    title_en: "",
    title_original: "",
    title_la: "",
  });
  const [slugTouched, setSlugTouched] = useState(mode === "edit");
  const [revisionId, setRevisionId] = useState<string | null>(null);
  const [documentId, setDocumentId] = useState<number | null>(null);
  const [documentRevision, setDocumentRevision] = useState<string | null>(null);
  const [initialBlocks, setInitialBlocks] = useState<PartialBlock[] | null>(null);
  const [indicators, setIndicators] = useState<Indicator[]>([]);
  const [suggested, setSuggested] = useState<SuggestedParameter[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [media, setMedia] = useState<
    { attachment_id: number; asset_id: string; caption: string | null; role_title: string }[]
  >([]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const problemsState = useState<Record<string, string>>({});

  useEffect(() => {
    api.capabilities().then((caps: Capabilities) => {
      setTypes(caps.entity_types ?? []);
    }).catch(() => {});
  }, []);

  // Что подсказывает выбранная ветвь: и для новой записи, и при смене типа.
  useEffect(() => {
    if (!form.type) return;
    api.parametersForType(form.type)
      .then((result) => setSuggested(result.items ?? []))
      .catch(() => setSuggested([]));
  }, [form.type]);

  useEffect(() => {
    if (mode !== "edit" || !entityId) {
      setInitialBlocks([]);
      return;
    }
    api.entity(entityId).then(async (entity) => {
      setForm({
        type: entity.type,
        slug: entity.slug,
        title_ru: entity.title_ru,
        title_en: entity.title_en ?? "",
        title_original: entity.title_original ?? "",
        title_la: entity.title_la ?? "",
      });
      setRevisionId(entity.latest_revision_id);
      setMedia((entity as unknown as { media?: typeof media }).media ?? []);
      setTags((entity as unknown as { tags?: Tag[] }).tags ?? []);
      setIndicators((entity as unknown as { indicators?: Indicator[] }).indicators ?? []);

      const described = (entity as unknown as { description_document_id?: number })
        .description_document_id;
      if (described) {
        const doc = await api.document(described);
        setDocumentId(doc.id);
        setDocumentRevision(doc.latest_revision_id);
        setInitialBlocks((doc.body_json as PartialBlock[]) ?? []);
      } else {
        setInitialBlocks([]);
      }
    }).catch((e) => {
      setError(e.message);
      setInitialBlocks([]);
    });
  }, [mode, entityId]);

  const editor = useMemo(() => initialBlocks, [initialBlocks]);

  if (editor === null) return <p className="notice">Загружаем…</p>;
  return (
    <EditorBody
      mode={mode}
      entityId={entityId}
      form={form}
      setForm={setForm}
      slugTouched={slugTouched}
      setSlugTouched={setSlugTouched}
      types={types}
      indicators={indicators}
      setIndicators={setIndicators}
      suggested={suggested}
      media={media}
      tags={tags}
      setTags={setTags}
      reloadAttachments={() => {
        if (entityId) {
          api.entity(entityId)
            .then((entity) => {
              const card = entity as unknown as { media?: typeof media };
              setMedia(card.media ?? []);
            })
            .catch(() => {});
        }
      }}
      initialBlocks={editor}
      revisionId={revisionId}
      setRevisionId={setRevisionId}
      documentId={documentId}
      setDocumentId={setDocumentId}
      documentRevision={documentRevision}
      setDocumentRevision={setDocumentRevision}
      status={status}
      setStatus={setStatus}
      error={error}
      setError={setError}
      saving={saving}
      setSaving={setSaving}
      problemsState={problemsState}
      navigate={navigate}
    />
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function EditorBody(props: any) {
  const {
    mode, entityId, form, setForm, slugTouched, setSlugTouched, types,
    indicators, setIndicators, suggested,
    media, tags, setTags, reloadAttachments, initialBlocks,
    revisionId, setRevisionId, documentId, setDocumentId,
    documentRevision, setDocumentRevision, status, setStatus,
    error, setError, saving, setSaving, navigate,
  } = props;

  const editor = useCreateBlockNote({
    schema,
    initialContent: initialBlocks.length > 0 ? withEditableEdges(initialBlocks) : undefined,
  });

  const [problems, setProblems] = props.problemsState;

  const field = (
    name: string,
    label: string,
    hint?: string,
    extra?: Record<string, unknown>,
  ) => (
    <label>
      {label}
      <input
        value={form[name] ?? ""}
        onChange={(e) => {
          const next = { ...form, [name]: e.target.value };
          // Пока адрес страницы не правили руками, держим его в согласии с названием.
          if (name === "title_ru" && !slugTouched) next.slug = slugify(e.target.value);
          if (name === "slug") setSlugTouched(true);
          setForm(next);
        }}
        {...extra}
      />
      {hint && !problems[name] && <span className="hint">{hint}</span>}
      {problems[name] && <span className="field-error">{problems[name]}</span>}
    </label>
  );

  const save = async () => {
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      setProblems({});
      const payload = {
        type: form.type,
        slug: form.slug.trim(),
        title_ru: form.title_ru.trim(),
        title_en: form.title_en || null,
        title_original: form.title_original || null,
        title_la: form.title_la || null,
      };

      let id = entityId;
      if (mode === "create") {
        const created = await api.createEntity(payload);
        id = created.id;
        setRevisionId(created.revision_id);
      } else {
        const updated = await api.updateEntity(entityId!, {
          ...payload,
          base_revision_id: revisionId,
        });
        setRevisionId(updated.revision_id);
      }

      if (id) await api.setEntityTags(id, tags.map((tag: Tag) => tag.title));

      // Показатели — часть материала записи, поэтому пишутся после неё
      // и от её же версии (Р-38).
      if (id && indicators.length > 0) {
        const saved = await api.saveIndicators(id, indicators, revisionId);
        if (saved.revision_id) setRevisionId(saved.revision_id);
        setIndicators(saved.items ?? indicators);
      }

      const blocks = editor.document;
      if (documentId) {
        const saved = await api.updateDocument(documentId, {
          body: blocks,
          base_revision_id: documentRevision,
        });
        setDocumentRevision(saved.revision_id);
      } else {
        const created = await api.createDocument({
          title: `Описание: ${payload.title_ru}`,
          body: blocks,
          attach_to_entity_id: id,
          role: "description",
        });
        setDocumentId(created.id);
        setDocumentRevision(created.revision_id);
      }

      setStatus("Сохранено");
      if (mode === "create") navigate(`/entities/${id}`);
    } catch (e) {
      const apiError = e as ApiError;
      if (apiError.code === "validation_failed" && apiError.details) {
        setProblems(apiError.details as Record<string, string>);
      }
      setError(
        apiError.code === "version_conflict"
          ? "Материал изменён другим редактором. Откройте карточку заново, чтобы не потерять чужую правку."
          : apiError.message,
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section>
      <h1>{mode === "create" ? "Новый объект" : "Правка объекта"}</h1>
      <p className="sub">Свойства и описание. Каждое сохранение создаёт версию.</p>

      {error && <p className="error">{error}</p>}
      {status && <p className="notice">{status}</p>}

      <div className="form">
        <label>
          Тип
          <select
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
          >
            {types.map((t: EntityType) => (
              <option key={t.code} value={t.code}>
                {"  ".repeat(t.depth) + (t.depth > 0 ? "– " : "") + t.title_ru}
              </option>
            ))}
          </select>
          <span className="hint">
            Верхние ветви — кто, что и когда; ниже — тип записи
          </span>
        </label>
        {field("title_ru", "Название по-русски")}
        {field(
          "slug",
          "Адрес страницы",
          "Часть ссылки на карточку, латиницей. Подставляется из названия, можно изменить.",
          { placeholder: "muzey-terrakotovoy-armii" },
        )}
        <div className="row">
          {field("title_en", "Название по-английски")}
          {field("title_original", "Название на языке оригинала")}
          {field("title_la", "Латинское наименование", "Научное латинское имя, если оно есть")}
        </div>
        <label>
          Метки
          <TagsField
            value={tags}
            onChange={setTags}
            hint="Наберите # и выберите слово из справочника или добавьте новое"
          />
        </label>
      </div>

      <IndicatorsField
        indicators={indicators}
        suggested={suggested}
        onChange={setIndicators}
      />

      <h2>Описание</h2>
      <div className="editor-layout">
        <div
          className="editor-shell"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            const entityPayload = event.dataTransfer.getData("application/x-2vhutemas-entity");
            const mediaPayload = event.dataTransfer.getData("application/x-2vhutemas-media");
            if (!entityPayload && !mediaPayload) return;
            event.preventDefault();
            if (entityPayload) insertEntityCard(editor, JSON.parse(entityPayload));
            if (mediaPayload) insertMediaImage(editor, JSON.parse(mediaPayload));
          }}
        >
          <BlockNoteView editor={editor} theme="light" />
        </div>
        <div className="editor-side">
          <EntityPanel
            entityId={entityId}
            onInsertCard={(entity) => insertEntityCard(editor, entity)}
            onInsertMention={(entity) => insertEntityMention(editor, entity)}
          />
          <MediaPanel
            entityId={entityId}
            attached={media}
            onInsert={(asset) => insertMediaImage(editor, asset)}
            onChanged={reloadAttachments}
          />
        </div>
      </div>

      <div className="row" style={{ marginTop: 18 }}>
        <button type="button" onClick={save} disabled={saving}>
          {saving ? "Сохраняем…" : "Сохранить версию"}
        </button>
        {entityId && (
          <button type="button" className="ghost" onClick={() => navigate(`/entities/${entityId}`)}>
            К карточке
          </button>
        )}
      </div>
    </section>
  );
}
