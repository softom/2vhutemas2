/**
 * Окно файла: загрузка нового и правка сведений (правило 15, решение Р-26).
 *
 * Зона файла принимает перетаскивание: брошенный файл загружается сразу,
 * и окно переходит к правке созданной записи — сведения дописываются поверх.
 * Кнопка выбора файла остаётся для тех, кому так привычнее.
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

export function MediaDialog({ asset, onSaved, onClose }: Props) {
  const [current, setCurrent] = useState<MediaAsset | null>(asset ?? null);
  const [draft, setDraft] = useState<Draft>(() => toDraft(asset));
  const [tags, setTags] = useState<Tag[]>(() => (asset as unknown as { tags?: Tag[] })?.tags ?? []);
  const [kinds, setKinds] = useState<{ code: string; title_ru: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [chosen, setChosen] = useState<File | null>(null);
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

  /** Сведения, уже введённые в форме, уходят вместе с файлом — вводить дважды не нужно. */
  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("caption", draft.caption || file.name);
      for (const [key, value] of Object.entries(draft)) {
        if (key !== "caption" && value) form.append(key, value);
      }
      if (tags.length > 0) form.append("keywords", tags.map((tag) => tag.title).join(", "));

      const created = await api.uploadMedia(form);
      setCurrent(created);
      setDraft(toDraft(created));
      setChosen(null);
      setDirty(false);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!current) {
      const file = chosen ?? fileInput.current?.files?.[0] ?? null;
      if (!file) {
        setError("Перетащите файл в зону или выберите его");
        return;
      }
      await upload(file);
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
                const file = event.dataTransfer.files?.[0];
                // Брошенный файл загружается сразу: подтверждение здесь лишнее.
                if (file) upload(file);
              }}
            >
              <p className="dropzone-title">
                {busy
                  ? "Загружаем и обрабатываем…"
                  : chosen
                  ? `Выбран файл: ${chosen.name}`
                  : "Перетащите файл сюда — он загрузится сразу"}
              </p>
              <input
                ref={fileInput}
                type="file"
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  setChosen(file);
                  setDirty(true);
                }}
              />
              <span className="hint">
                Изображения, PDF и видео. Оригинал сохраняется неизменным.
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
