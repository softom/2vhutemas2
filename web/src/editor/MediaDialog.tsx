/**
 * Окно файла: загрузка нового и правка сведений (правило 15, решение Р-26).
 *
 * Зона файла принимает перетаскивание: брошенные файлы загружаются сразу,
 * и окно переходит к правке созданной записи — сведения дописываются поверх.
 * Кнопка выбора файла остаётся для тех, кому так привычнее.
 *
 * Если окно открыто из редактора объекта, загруженные файлы сразу
 * прикрепляются к нему (решение Р-31): именно поэтому можно бросать
 * несколько файлов за раз — каждый окажется в карточке объекта.
 *
 * Переключателя доступа нет: файл виден настолько, насколько опубликован
 * материал, к которому он относится (решение Р-28).
 */
import { useEffect, useRef, useState } from "react";
import { api, type Capabilities, type MediaAsset } from "../api";
import { Modal } from "../ui/Modal";
import { type Tag, TagsField } from "./TagsField";

const EMPTY = {
  kind: "photo",
  caption: "",
  author: "",
  source_url: "",
  license: "",
};

type Draft = typeof EMPTY;

interface Props {
  /** Пусто — загрузка нового файла. */
  asset?: MediaAsset | null;
  /** Объект, из редактора которого открыто окно: файлы прикрепятся к нему. */
  entityId?: number | null;
  /** Роль прикрепления; по умолчанию галерея. */
  role?: string;
  onSaved: () => void;
  onClose: () => void;
}

function toDraft(asset?: MediaAsset | null): Draft {
  if (!asset) return { ...EMPTY };
  const extra = asset as unknown as Record<string, unknown>;
  return {
    kind: (extra.kind as string) ?? "photo",
    caption: asset.caption_ru ?? "",
    author: (extra.author as string) ?? "",
    source_url: (extra.source_url as string) ?? "",
    license: (extra.license_code as string) ?? "",
  };
}

export function MediaDialog({ asset, entityId, role, onSaved, onClose }: Props) {
  const [current, setCurrent] = useState<MediaAsset | null>(asset ?? null);
  const [draft, setDraft] = useState<Draft>(() => toDraft(asset));
  const [tags, setTags] = useState<Tag[]>(() => (asset as unknown as { tags?: Tag[] })?.tags ?? []);
  const [kinds, setKinds] = useState<{ code: string; title_ru: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [chosen, setChosen] = useState<File[]>([]);
  const [uploaded, setUploaded] = useState<MediaAsset[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.capabilities()
      .then((caps: Capabilities) => setKinds(caps.dictionaries.media_kinds ?? []))
      .catch(() => {});
  }, []);

  const set = (name: keyof Draft, value: string) => {
    setDraft({ ...draft, [name]: value });
    setDirty(true);
  };

  const field = (name: keyof Draft, label: string, hint?: string) => (
    <label>
      {label}
      <input value={draft[name]} onChange={(event) => set(name, event.target.value)} />
      {hint && <span className="hint">{hint}</span>}
    </label>
  );

  /**
   * Сведения из формы уходят вместе с каждым файлом — вводить дважды не нужно.
   * Подпись у одиночного файла берётся из формы, у пачки — из имени файла:
   * одна подпись на десять разных изображений была бы неправдой.
   */
  const upload = async (files: File[]) => {
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    const created: MediaAsset[] = [];
    const failed: string[] = [];

    for (const [index, file] of files.entries()) {
      setProgress(`Загружаем ${index + 1} из ${files.length}: ${file.name}`);
      try {
        const form = new FormData();
        form.append("file", file);
        form.append("caption", files.length === 1 ? (draft.caption || file.name) : file.name);
        for (const [key, value] of Object.entries(draft)) {
          if (key !== "caption" && value) form.append(key, value);
        }
        if (tags.length > 0) form.append("keywords", tags.map((tag) => tag.title).join(", "));

        const asset = await api.uploadMedia(form);
        created.push(asset);

        // Файл, загруженный из редактора объекта, сразу оказывается в карточке.
        if (entityId) {
          await api.attachMedia({
            entity_id: entityId,
            asset_id: asset.id,
            role: role ?? "gallery",
          });
        }
      } catch (e) {
        failed.push(`${file.name}: ${(e as Error).message}`);
      }
    }

    setProgress(null);
    setBusy(false);
    setChosen([]);
    setUploaded(created);
    if (failed.length > 0) setError(`Не загрузились — ${failed.join("; ")}`);
    if (created.length > 0) {
      onSaved();
      if (created.length === 1) {
        setCurrent(created[0]);
        setDraft(toDraft(created[0]));
        setDirty(false);
      }
    }
  };

  const save = async () => {
    if (!current) {
      const files = chosen.length > 0
        ? chosen
        : Array.from(fileInput.current?.files ?? []);
      if (files.length === 0) {
        setError("Перетащите файлы в зону или выберите их");
        return;
      }
      await upload(files);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await api.updateMedia(current.id, {
        kind: draft.kind,
        caption: draft.caption || null,
        author: draft.author || null,
        source_url: draft.source_url || null,
        license: draft.license || null,
      });
      await api.setMediaTags(current.id, tags.map((tag) => tag.title));
      setDirty(false);
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={current ? "Редактирование файла" : "Загрузить файл"}
      dirty={dirty}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={save} disabled={busy}>
            {busy ? "Сохраняем…" : current ? "Сохранить" : "Загрузить"}
          </button>
          <button type="button" className="ghost" onClick={onClose}>
            {current ? "Закрыть" : "Отмена"}
          </button>
        </>
      }
    >
      <div className="form">
        {current
          ? (
            <img
              src={api.mediaFileUrl(current.id, "screen")}
              alt={draft.caption}
              style={{ width: "100%", maxHeight: 280, objectFit: "contain", borderRadius: 8 }}
            />
          )
          : (
            <div
              className={`dropzone${dragOver ? " over" : ""}`}
              onDragOver={(event) => {
                event.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragOver(false);
                // Брошенные файлы загружаются сразу: подтверждение здесь лишнее.
                upload(Array.from(event.dataTransfer.files ?? []));
              }}
            >
              <p className="dropzone-title">
                {busy
                  ? (progress ?? "Загружаем и обрабатываем…")
                  : chosen.length > 0
                  ? `Выбрано файлов: ${chosen.length}`
                  : "Перетащите файлы сюда — они загрузятся сразу"}
              </p>
              <input
                ref={fileInput}
                type="file"
                multiple
                disabled={busy}
                onChange={(event) => {
                  setChosen(Array.from(event.target.files ?? []));
                  setDirty(true);
                }}
              />
              <span className="hint">
                Изображения, PDF и видео. Можно выбрать несколько.
                {entityId ? " Загруженные файлы сразу прикрепятся к объекту." : ""}
              </span>
            </div>
          )}

        <label>
          Вид изображения
          <select value={draft.kind} onChange={(event) => set("kind", event.target.value)}>
            {kinds.map((item) => <option key={item.code} value={item.code}>{item.title_ru}</option>)}
          </select>
        </label>

        {field("caption", "Подпись", "Как подписываем изображение")}
        {field("author", "Автор изображения", "Фотограф, чертёжник")}
        <div className="row">
          {field("source_url", "Ссылка на источник")}
          {field("license", "Лицензия")}
        </div>
        <label>
          Метки
          <TagsField
            value={tags}
            onChange={(next) => {
              setTags(next);
              setDirty(true);
            }}
            hint="Наберите # и выберите слово из справочника или добавьте новое"
          />
        </label>

        {uploaded.length > 1 && (
          <div>
            <h4>Загружено файлов: {uploaded.length}</h4>
            <ul className="panel-list media-list">
              {uploaded.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="panel-item-main linklike"
                    onClick={() => {
                      setCurrent(item);
                      setDraft(toDraft(item));
                      setUploaded([]);
                    }}
                  >
                    <img
                      className="panel-thumb"
                      src={api.mediaFileUrl(item.id, "thumbnail")}
                      alt={item.caption_ru ?? ""}
                    />
                    <span className="panel-item-title">{item.caption_ru ?? "без подписи"}</span>
                    <span className="panel-item-sub">щелчок — дописать сведения</span>
                  </button>
                </li>
              ))}
            </ul>
            {entityId && <p className="hint">Все файлы прикреплены к объекту.</p>}
          </div>
        )}

        {current && (
          <p className="hint">
            <a href={api.mediaFileUrl(current.id, "original")} target="_blank" rel="noreferrer">
              Открыть оригинал
            </a>
          </p>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </Modal>
  );
}
