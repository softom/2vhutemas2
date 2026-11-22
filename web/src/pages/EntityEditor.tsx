/**
 * Редактор объекта: свойства и описание в BlockNote.
 *
 * Правка отправляется вместе с версией, от которой началась (Р-03):
 * если материал успели изменить, сервер вернёт конфликт и правка не затрётся.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
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
import { AttachedMedia } from "../editor/AttachedMedia";
import { IndicatorsField } from "../editor/IndicatorsField";
import {
  createSchema,
  insertEntityCard,
  insertEntityMention,
  insertMediaImage,
  prepareEditorBlocks,
} from "../editor/entityBlocks";
import { InsertPicker, type PickerTab } from "../editor/InsertPicker";
import { type Tag, TagsField } from "../editor/TagsField";


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
  const [search] = useSearchParams();
  const entityKey = params.id;
  const [entityId, setEntityId] = useState<number | null>(null);
  // С каким типом открыли экран: «Создать лекцию» приводит сюда с ?type=lecture.
  const requestedType = search.get("type");

  const [types, setTypes] = useState<EntityType[]>([]);
  // Разделы формы по типу записи — настройка editor таблицы отображений.
  const [editorViews, setEditorViews] = useState<Record<string, string[]>>({});
  const [form, setForm] = useState({
    type: requestedType ?? "what",
    slug: "",
    title_ru: "",
    title_en: "",
    title_original: "",
    title_la: "",
  });
  const [slugTouched, setSlugTouched] = useState(mode === "edit");
  const [revisionId, setRevisionId] = useState<string | null>(null);
  const [entityStatus, setEntityStatus] = useState("draft");
  const [materialId, setMaterialId] = useState<string | null>(null);
  const [publishedRevision, setPublishedRevision] = useState<string | null>(null);
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
      setEditorViews(Object.fromEntries(
        Object.entries(caps.presentations ?? {}).map(([type, modes]) =>
          [type, (modes.editor ?? []).map((item) => item.component)]),
      ));
    }).catch(() => {});
  }, []);

  // Что подсказано: у сохранённой записи — её ветвь вместе с наборами,
  // прикреплёнными лично ей; у новой — выбранная ветвь.
  useEffect(() => {
    if (mode === "edit" && entityId) {
      api.parametersForEntity(entityId)
        .then((result) => setSuggested(result.items ?? []))
        .catch(() => setSuggested([]));
      return;
    }
    if (!form.type) return;
    api.parametersForType(form.type)
      .then((result) => setSuggested(result.items ?? []))
      .catch(() => setSuggested([]));
  }, [form.type, mode, entityId]);

  useEffect(() => {
    if (mode !== "edit" || !entityKey) {
      setInitialBlocks([]);
      return;
    }
    api.entity(entityKey).then(async (entity) => {
      setEntityId(entity.id);
      setEntityStatus(entity.material_status ?? "draft");
      setForm({
        type: entity.type,
        slug: entity.slug,
        title_ru: entity.title_ru,
        title_en: entity.title_en ?? "",
        title_original: entity.title_original ?? "",
        title_la: entity.title_la ?? "",
      });
      setRevisionId(entity.latest_revision_id);
      setMaterialId(entity.material_id);
      setPublishedRevision((entity as unknown as {published_revision_id:string|null}).published_revision_id);
      setMedia((entity as unknown as { media?: typeof media }).media ?? []);
      setTags((entity as unknown as { tags?: Tag[] }).tags ?? []);
      const loaded = (entity as unknown as { indicators?: Indicator[] }).indicators ?? [];
      setIndicators(loaded);

      setInitialBlocks(((entity as unknown as {body_json?: PartialBlock[]}).body_json) ?? []);
    }).catch((e) => {
      setError(e.message);
      setInitialBlocks([]);
    });
  }, [mode, entityKey]);

  const editor = useMemo(() => initialBlocks, [initialBlocks]);

  if (mode === "edit" && error && !revisionId) return <p className="error">{error}</p>;
  if (editor === null) return <p className="notice">Загружаем…</p>;
  return (
    <EditorBody
      entityStatus={entityStatus}
      setEntityStatus={setEntityStatus}
      mode={mode}
      entityId={entityId}
      setEntityId={setEntityId}
      form={form}
      setForm={setForm}
      slugTouched={slugTouched}
      setSlugTouched={setSlugTouched}
      types={types}
      editorViews={editorViews}
      indicators={indicators}
      setIndicators={setIndicators}
      suggested={suggested}
      setSuggested={setSuggested}
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
      materialId={materialId}
      setMaterialId={setMaterialId}
      publishedRevision={publishedRevision}
      setPublishedRevision={setPublishedRevision}
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
    entityStatus, setEntityStatus, mode, entityId, setEntityId, form, setForm, slugTouched, setSlugTouched, types, editorViews,
    indicators, setIndicators, suggested, setSuggested,
    media, tags, setTags, reloadAttachments, initialBlocks,
    revisionId, setRevisionId, materialId, setMaterialId,
    publishedRevision, setPublishedRevision, status, setStatus,
    error, setError, saving, setSaving, navigate,
  } = props;

  // Своя схема на каждый редактор: общая роняла второй показ при переходе
  // с карточки на карточку («Position undefined out of range»).
  const schema = useMemo(() => createSchema(), []);
  // Отметка «Сохранено» держится несколько секунд; ошибка остаётся,
  // пока её не исправят.
  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatus(null), 4000);
    return () => clearTimeout(timer);
  }, [status]);

  const editor = useCreateBlockNote({
    schema,
    initialContent: initialBlocks.length > 0 ? prepareEditorBlocks(initialBlocks) : undefined,
  });

  const [versions, setVersions] = useState<Awaited<ReturnType<typeof api.entityVersions>>["items"]>([]);

  useEffect(() => { if (entityId) api.entityVersions(entityId).then(result => setVersions(result.items)).catch(() => {}); }, [entityId, revisionId, publishedRevision]);
  const [canDelete, setCanDelete] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => { api.me().then(me => setCanDelete(me.permissions.includes("create_delete") || me.permissions.includes("su"))).catch(() => {}); }, []);
  const [canPublish, setCanPublish] = useState(false);
  const [confirmPublishNow, setConfirmPublishNow] = useState(false);
  useEffect(() => { api.me().then(me => setCanPublish(me.permissions.includes("publish") || me.permissions.includes("su"))).catch(() => setCanPublish(false)); }, []);
  const [problems, setProblems] = props.problemsState;
  // Блок вставки и прикрепления раскрывается там, где его вызвали: над
  // текстом или в разделе изображений (вместо узкой колонки справа).
  const [picker, setPicker] = useState<{ tab: PickerTab; at: "text" | "gallery"; seq: number } | null>(null);
  // Каждое нажатие — новый номер: открытый блок прокручивается в поле зрения.
  const openPicker = (tab: PickerTab, at: "text" | "gallery") =>
    setPicker((current) => ({ tab, at, seq: (current?.seq ?? 0) + 1 }));
  const pickerBlock = (at: "text" | "gallery") => picker?.at === at && (
    <InsertPicker
      key={`${at}-${picker.tab}`}
      entityId={entityId}
      types={types}
      initialTab={picker.tab}
      focus={picker.seq}
      attached={media}
      onInsertCard={(entity) => insertEntityCard(editor, entity)}
      onInsertMention={(entity) => insertEntityMention(editor, entity)}
      onInsertMedia={(asset) => insertMediaImage(editor, asset)}
      onChanged={reloadAttachments}
      onClose={() => setPicker(null)}
    />
  );
  const typeTitle = types.find((item: EntityType) => item.code === form.type)?.title_ru ?? "";
  const isNews = (() => {
    let code: string | null = form.type;
    const seen = new Set<string>();
    while (code && !seen.has(code)) {
      if (code === "news") return true;
      seen.add(code);
      code = types.find((item: EntityType) => item.code === code)?.parent ?? null;
    }
    return false;
  })();
  useEffect(() => { setConfirmPublishNow(false); }, [form.type]);

  // Какие разделы у формы и в каком порядке, решает тип записи (настройка
  // editor таблицы отображений). Название есть всегда: без него запись не
  // сохранить. Пока настройки не пришли — прежний полный состав.
  const configured: string[] = editorViews[form.type] ?? [];
  const sections: string[] = configured.length > 0
    ? (configured.includes("title") ? configured : ["title", ...configured])
    : ["title", "tags", "indicators", "gallery", "text"];
  const hasText = sections.includes("text");

  // Адрес ролика подсказывает тип: ссылку на YouTube, VK Видео или Rutube
  // заводят «Видео», а не «Веб-страницей». Тип не меняется сам — только
  // предлагается; решает редактор.
  const VIDEO_HOSTS = /(youtube\.com|youtu\.be|vk\.com\/video|vkvideo\.ru|rutube\.ru)/i;
  const looksLikeVideo = form.type === "web_page" && types.some((t: EntityType) => t.code === "video") &&
    (indicators as Indicator[]).some((indicator) =>
      indicator.values.some((value) => value.parameter === "url" && VIDEO_HOSTS.test(value.text_value ?? ""))
    );

  function updateField(name: string, value: string) {
    const next = { ...form, [name]: value };
    if (name === "title_ru" && !slugTouched) next.slug = slugify(value);
    if (name === "slug") setSlugTouched(true);
    setForm(next);
  }

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
        onChange={(e) => updateField(name, e.target.value)}
        {...extra}
      />
      {hint && !problems[name] && <span className="hint">{hint}</span>}
      {problems[name] && <span className="field-error">{problems[name]}</span>}
    </label>
  );

  const save = async (publish = false, confirmedNow = false, nextIndicators?: Indicator[]) => {
    if (publish && canPublish && isNews && !confirmedNow) {
      setConfirmPublishNow(true);
      return;
    }
    setConfirmPublishNow(false);
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
        // Без раздела текста форма текст не трогает: прежний сохраняется.
        ...(hasText ? { body_json: editor.document } : {}),
        indicators: nextIndicators ?? indicators,
        tags: tags.map((tag: Tag) => tag.title),
      };

      let id = entityId;
      // Сведения, параметры, метки и МультиТекст — одна транзакция и версия.
      let revision = revisionId;
      let material = materialId;
      if (!entityId) {
        const created = await api.createEntity(payload);
        id = created.id;
        setEntityId(id);
        revision = created.revision_id;
        material = created.material_id;
      } else {
        const updated = await api.updateEntity(entityId!, {
          ...payload,
          base_revision_id: revision,
        });
        revision = updated.revision_id;
      }
      setRevisionId(revision);
      setMaterialId(material);

      if (publish && material && revision) {
        if (canPublish) { await api.publishMaterial(material, revision); setPublishedRevision(revision); window.dispatchEvent(new CustomEvent("research-publication-updated")); }
        else await api.submitMaterial(material);
      }
      setStatus(publish ? (canPublish ? "Опубликовано" : "Отправлено на рассмотрение") : "Рабочая версия сохранена");
      if (mode === "create") navigate(`/entities/${id}`);
      return revision as string;
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

  const openVersionText = async (revision: string) => {
    if (!entityId || !window.confirm("Заменить открытый текст текстом выбранной версии? Изменения можно сохранить новой рабочей версией.")) return;
    setSaving(true); setError(null);
    try {
      const {body} = await api.entityVersionBody(entityId, revision);
      editor.replaceBlocks(editor.document, body.length ? prepareEditorBlocks(body) : [{type:"paragraph"}]);
      setStatus("Текст версии открыт в редакторе. Для сохранения нажмите «Сохранить версию».");
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  };

  const publishVersion = async (revision: string) => {
    if (!materialId || !window.confirm("Показать читателям выбранную версию материала целиком? Рабочие правки сохранятся в редакторе.")) return;
    setSaving(true); setError(null);
    try {
      await api.publishMaterial(materialId, revision);
      setPublishedRevision(revision);
      setEntityStatus("published");
      window.dispatchEvent(new CustomEvent("research-publication-updated"));
      setStatus("Выбранная версия опубликована");
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  };

  const changeArchive = async (action: "archive" | "restore") => {
    if (!entityId || !revisionId) return;
    setSaving(true); setError(null);
    try {
      const result = await api.changeEntityArchive(entityId, action, revisionId);
      setEntityStatus(result.status); setRevisionId(result.revision_id);
      setPublishedRevision(null); setConfirmDelete(false);
      setStatus(action === "archive" ? "Запись в корзине" : "Восстановлено в черновик");
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  };

  const unpublish = async () => {
    if (!entityId) return;
    if (!confirm("Снять запись с публикации? Читатели перестанут её видеть; версии сохранятся.")) return;
    setSaving(true);
    setError(null);
    try {
      await api.unpublishEntity(entityId);
      setPublishedRevision(null);
      setStatus("Снято с публикации: запись — черновик");
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setSaving(false);
    }
  };

  // Кнопки сохранения стоят и сверху, и снизу: форма длиннее экрана,
  // и искать кнопку в её конце неудобно.
  const actions = (
    <div className="row">
      <button type="button" onClick={() => save(false)} disabled={saving}>
        {saving ? "Сохраняем…" : "Сохранить версию"}
      </button>
      <button type="button" onClick={() => save(true)} disabled={saving}>
        {canPublish ? (isNews ? "Опубликовать сейчас…" : "Сохранить и опубликовать") : "Сохранить и отправить на рассмотрение"}
      </button>
      {/* Снятие с публикации — обратно в черновик; версии и история целы,
          опубликовать снова можно той же кнопкой. */}
      {entityId && canPublish && publishedRevision && (
        <button type="button" className="ghost" onClick={unpublish} disabled={saving}>
          Снять с публикации
        </button>
      )}
      {entityId && (
        <button type="button" className="ghost" onClick={() => globalThis.location.assign(`/entities/${entityId}`)}>
          К карточке
        </button>
      )}
      {entityId && canDelete && <button type="button" className="ghost" disabled={saving} onClick={() => setConfirmDelete(true)}>Удалить…</button>}
      {confirmDelete && <div className="notice" style={{flexBasis:"100%"}}>
        <p>Удалить запись в корзину? Она исчезнет из каталогов, в том числе у администратора. Текст, история, медиа и связи сохранятся. Несохранённые правки этой формы не записываются.</p>
        <button type="button" disabled={saving} onClick={() => changeArchive("archive")}>Удалить в корзину</button>{" "}
        <button type="button" className="ghost" onClick={() => setConfirmDelete(false)}>Отмена</button>
      </div>}
      {/* Итог сохранения виден там же, где нажимали: у обеих кнопок. */}
      {status && <span className="save-mark ok">{status}</span>}
      {error && <span className="save-mark fail" role="alert">{error}</span>}
      {isNews && <p className="hint" style={{ flexBasis: "100%" }}>
        «Сохранить версию» сохраняет правки без публикации и не меняет очередь выпуска.
        Если новость стоит в стеке, робот выпустит её по расписанию.
      </p>}
      {isNews && confirmPublishNow && <div className="notice" style={{ flexBasis: "100%" }}>
        <p>Сохранить правки и открыть новость читателям прямо сейчас, не дожидаясь назначенного времени выпуска?</p>
        <div className="row">
          <button type="button" disabled={saving} onClick={() => save(true, true)}>Да, опубликовать сейчас</button>
          <button type="button" className="ghost" disabled={saving} onClick={() => setConfirmPublishNow(false)}>Отмена</button>
        </div>
      </div>}
    </div>
  );

  if (entityStatus === "archived") return <section>
    <h1>{form.title_ru}</h1><p>Запись в корзине. Текст, медиа, связи и история сохранены.</p>
    {error && <p className="error" role="alert">{error}</p>}
    {canDelete && <button type="button" disabled={saving} onClick={() => changeArchive("restore")}>Восстановить в черновик</button>}
    <p><a href="/objects?archived=only">Корзина проектов</a> · <a href="/objects">К проектам</a></p>
  </section>;

  return (
    <section className="entity-editor">
      <div className="editor-eyebrow">{mode==='create'?'Новая запись':'Редактор сущности'} · {typeTitle}</div>
      <h1 aria-label={form.title_ru || "Новая запись"}>
        <textarea
          aria-label="Название сущности по-русски"
          rows={1}
          value={form.title_ru}
          placeholder={mode === "create" && typeTitle ? `Новая запись: ${typeTitle}` : "Название сущности"}
          style={{ width: "100%", display: "block", fieldSizing: "content", resize: "none",
            font: "inherit", letterSpacing: "inherit", color: "inherit", background: "transparent",
            border: 0, padding: 0, margin: 0, minHeight: 0 } as React.CSSProperties}
          onChange={(e) => updateField("title_ru", e.target.value.replace(/[\r\n]+/g, " "))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
        />
      </h1>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:16,alignItems:'start',marginBottom:20}}>
        {field("title_en", "Название по-английски")}
        {field("title_original", "Название на языке оригинала")}
        {field("title_la", "Латинское наименование", "Научное латинское имя, если оно есть")}
      </div>
      <p className="sub">Свойства и описание сохраняются одной версией. {publishedRevision ? (publishedRevision === revisionId ? "Открыта опубликованная версия." : "Есть рабочие изменения; читатели видят прежнюю версию.") : "Запись ещё не опубликована."}</p>

      {actions}
      {entityId && <details><summary>История версий</summary><ul>
        {versions.map(version => <li key={version.id}>
          {new Date(version.created_at).toLocaleString("ru-RU")} — {version.editor || "Редактор"}: {version.summary}
          {version.id === publishedRevision && " · публичная"}{version.is_working && " · в работе"}
          {!version.complete && " · прежняя частичная редакция"}
          {version.has_body && sections.includes("text") && <button type="button" className="ghost"
            disabled={saving} onClick={() => openVersionText(version.id)}>Открыть текст версии</button>}
          {canPublish && version.complete && version.id !== publishedRevision && entityStatus !== "archived" &&
            <button type="button" className="ghost" disabled={saving}
              onClick={() => publishVersion(version.id)}>Опубликовать эту версию</button>}
        </li>)}
      </ul></details>}

      {error && <p className="error">{error}</p>}
      {status && <p className="notice">{status}</p>}

      {sections.map((section) => {
        switch (section) {
          case "title":
            return (
              <div key="title">
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
                      Верхняя ветвь — род записи, ниже — её тип
                    </span>
                  </label>
                  {looksLikeVideo && (
                    <p className="notice">
                      Адрес ведёт на видеоролик.{" "}
                      <button type="button" className="ghost" onClick={() => setForm({ ...form, type: "video" })}>
                        Сделать «Видео»
                      </button>
                    </p>
                  )}
                  {field("title_ru", "Название по-русски")}
                  {field(
                    "slug",
                    "Адрес страницы",
                    "Часть ссылки на карточку, латиницей. Подставляется из названия, можно изменить.",
                    { placeholder: "muzey-terrakotovoy-armii" },
                  )}
                </div>
              </div>
            );
          case "tags":
            return (
              <div className="form" key="tags">
                <label>
                  Метки
                  <TagsField
                    value={tags}
                    onChange={setTags}
                    hint="Наберите # и выберите слово из справочника или добавьте новое"
                  />
                </label>
              </div>
            );
          case "indicators":
            return (
              <div key="indicators">
                <IndicatorsField
                  entityId={entityId}
                  onSuggested={setSuggested}
                  beforeResearch={()=>save(false)}
                  saveResearchValues={async (next:Indicator[])=>{const revision=await save(false,false,next);if(revision)setIndicators(next);return !!revision;}}
                  onRevision={setRevisionId}
                  indicators={indicators}
                  suggested={suggested}
                  onChange={setIndicators}
                />
              </div>
            );
          case "gallery":
            return (
              <div key="gallery">
                <AttachedMedia
                  entityId={entityId}
                  items={media}
                  onInsert={(item) =>
                    insertMediaImage(editor, { id: item.asset_id, caption_ru: item.caption })}
                  onChanged={reloadAttachments}
                  onPick={() => openPicker("media", "gallery")}
                />
                {pickerBlock("gallery")}
              </div>
            );
          case "text":
            return (
              <div key="text">
                <h2>Описание</h2>
                <div className="row picker-open">
                  <button type="button" className="ghost" onClick={() =>
                    editor.insertBlocks([{type: "widget"}], editor.getTextCursorPosition().block, "after")}>
                    Вставить виджет…
                  </button>
                  <button type="button" className="ghost" onClick={() => openPicker("entities", "text")}>
                    Вставить запись…
                  </button>
                  <button type="button" className="ghost" onClick={() => openPicker("media", "text")}>
                    Вставить или прикрепить изображение…
                  </button>
                </div>
                {pickerBlock("text")}
                <div className="editor-layout single">
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
                </div>
              </div>
            );
          default:
            return null;
        }
      })}


      <div style={{ marginTop: 18 }}>{actions}</div>
    </section>
  );
}
