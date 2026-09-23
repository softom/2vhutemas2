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
import { api, ApiError, type Capabilities } from "../api";
import { insertEntityCard, insertEntityMention, schema } from "../editor/entityBlocks";
import { EntityPanel } from "../editor/EntityPanel";

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

  const [kinds, setKinds] = useState<{ code: string; title_ru: string }[]>([]);
  const [objectTypes, setObjectTypes] = useState<{ code: string; title_ru: string }[]>([]);
  const [personTypes, setPersonTypes] = useState<{ code: string; title_ru: string }[]>([]);
  const [form, setForm] = useState({
    kind: "object",
    slug: "",
    title_ru: "",
    title_en: "",
    title_original: "",
    title_la: "",
    object_type: "",
    city: "",
    country: "",
    address: "",
    typology: "",
    person_type: "",
    full_name: "",
  });
  const [slugTouched, setSlugTouched] = useState(mode === "edit");
  const [revisionId, setRevisionId] = useState<string | null>(null);
  const [documentId, setDocumentId] = useState<number | null>(null);
  const [documentRevision, setDocumentRevision] = useState<string | null>(null);
  const [initialBlocks, setInitialBlocks] = useState<PartialBlock[] | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const problemsState = useState<Record<string, string>>({});

  useEffect(() => {
    api.capabilities().then((caps: Capabilities) => {
      setKinds(caps.dictionaries.entity_kinds ?? []);
      setObjectTypes(caps.dictionaries.object_types ?? []);
      setPersonTypes(caps.dictionaries.person_types ?? []);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (mode !== "edit" || !entityId) {
      setInitialBlocks([]);
      return;
    }
    api.entity(entityId).then(async (entity) => {
      const profile = entity.profile as Record<string, string | null>;
      setForm({
        kind: entity.kind,
        slug: entity.slug,
        title_ru: entity.title_ru,
        title_en: entity.title_en ?? "",
        title_original: entity.title_original ?? "",
        title_la: entity.title_la ?? "",
        object_type: (profile?.object_type as string) ?? "",
        city: profile?.city ?? "",
        country: profile?.country ?? "",
        address: profile?.address ?? "",
        typology: profile?.typology ?? "",
        person_type: (profile?.person_type as string) ?? "",
        full_name: profile?.full_name ?? "",
      });
      setRevisionId(entity.latest_revision_id);

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
      kinds={kinds}
      objectTypes={objectTypes}
      personTypes={personTypes}
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
    mode, entityId, form, setForm, slugTouched, setSlugTouched, kinds, objectTypes,
    personTypes, initialBlocks,
    revisionId, setRevisionId, documentId, setDocumentId,
    documentRevision, setDocumentRevision, status, setStatus,
    error, setError, saving, setSaving, navigate,
  } = props;

  const editor = useCreateBlockNote({
    schema,
    initialContent: initialBlocks.length > 0 ? initialBlocks : undefined,
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
      const profile = form.kind === "object"
        ? {
          object_type: form.object_type || null,
          city: form.city || null,
          country: form.country || null,
          address: form.address || null,
          typology: form.typology || null,
        }
        : form.kind === "person"
        ? {
          person_type: form.person_type || null,
          full_name: form.full_name || null,
        }
        : undefined;
      const payload = {
        kind: form.kind,
        slug: form.slug.trim(),
        title_ru: form.title_ru.trim(),
        title_en: form.title_en || null,
        title_original: form.title_original || null,
        title_la: form.title_la || null,
        profile,
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
          Вид
          <select
            value={form.kind}
            disabled={mode === "edit"}
            onChange={(e) => setForm({ ...form, kind: e.target.value })}
          >
            {kinds.map((k: { code: string; title_ru: string }) => (
              <option key={k.code} value={k.code}>{k.title_ru}</option>
            ))}
          </select>
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
        {form.kind === "object" && (
          <>
            <label>
              Тип объекта
              <select
                value={form.object_type}
                onChange={(e) => setForm({ ...form, object_type: e.target.value })}
              >
                <option value="">не указан</option>
                {objectTypes.map((t: { code: string; title_ru: string }) => (
                  <option key={t.code} value={t.code}>{t.title_ru}</option>
                ))}
              </select>
            </label>
            <div className="row">
              {field("city", "Город")}
              {field("country", "Страна")}
            </div>
            {field("address", "Почтовый адрес", "Улица, дом, индекс — как указано в источнике")}
            {field("typology", "Типология", "Театр, жилой дом, павильон")}
          </>
        )}

        {form.kind === "person" && (
          <>
            <label>
              Тип участника
              <select
                value={form.person_type}
                onChange={(e) => setForm({ ...form, person_type: e.target.value })}
              >
                <option value="">не указан</option>
                {personTypes.map((t: { code: string; title_ru: string }) => (
                  <option key={t.code} value={t.code}>{t.title_ru}</option>
                ))}
              </select>
            </label>
            {field("full_name", "Полное имя")}
          </>
        )}
      </div>

      <h2>Описание</h2>
      <div className="editor-layout">
        <div
          className="editor-shell"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            const payload = event.dataTransfer.getData("application/x-2vhutemas-entity");
            if (!payload) return;
            event.preventDefault();
            insertEntityCard(editor, JSON.parse(payload));
          }}
        >
          <BlockNoteView editor={editor} theme="light" />
        </div>
        <EntityPanel
          entityId={entityId}
          onInsertCard={(entity) => insertEntityCard(editor, entity)}
          onInsertMention={(entity) => insertEntityMention(editor, entity)}
        />
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
