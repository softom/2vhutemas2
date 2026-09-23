/**
 * Окно файла: загрузка нового и правка сведений (правило 15, решение Р-26).
 *
 * Одно окно на оба действия: при загрузке добавляется выбор файла, остальные
 * поля те же. Автор изображения, правообладатель и загрузивший — разные
 * сведения и разные поля.
 */
import { useEffect, useRef, useState } from "react";
import { api, type Capabilities, type MediaAsset } from "../api";
import { Modal } from "../ui/Modal";
import { type Tag, TagsField } from "./TagsField";

/**
 * Набор полей сокращён по решению пользователя: осталось то, без чего
 * нельзя честно опубликовать чужое изображение и найти своё.
 * Переключателя доступа нет: файл виден ровно настолько, насколько
 * опубликован материал, к которому он относится.
 */
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
  const [draft, setDraft] = useState<Draft>(() => toDraft(asset));
  const [tags, setTags] = useState<Tag[]>(
    () => ((asset as unknown as { tags?: Tag[] })?.tags ?? []),
  );
  const [kinds, setKinds] = useState<{ code: string; title_ru: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
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

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (asset) {
        await api.updateMedia(asset.id, {
          kind: draft.kind,
          caption: draft.caption || null,
          author: draft.author || null,
          source_url: draft.source_url || null,
          license: draft.license || null,
        });
        await api.setMediaTags(asset.id, tags.map((tag) => tag.title));
      } else {
        const file = fileInput.current?.files?.[0];
        if (!file) {
          setError("Выберите файл");
          setBusy(false);
          return;
        }
        const form = new FormData();
        form.append("file", file);
        form.append("caption", draft.caption || file.name);
        for (const [key, value] of Object.entries(draft)) {
          if (key !== "caption" && value) form.append(key, value);
        }
        if (tags.length > 0) form.append("keywords", tags.map((tag) => tag.title).join(", "));
        await api.uploadMedia(form);
      }
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
      title={asset ? "Редактирование файла" : "Загрузить файл"}
      dirty={dirty}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={save} disabled={busy}>
            {busy ? "Сохраняем…" : asset ? "Сохранить" : "Загрузить"}
          </button>
          <button type="button" className="ghost" onClick={onClose}>Отмена</button>
        </>
      }
    >
      <div className="form">
        {asset
          ? (
            <img
              src={api.mediaFileUrl(asset.id, "screen")}
              alt={draft.alt}
              style={{ width: "100%", maxHeight: 280, objectFit: "contain", borderRadius: 8 }}
            />
          )
          : (
            <label>
              Файл
              <input ref={fileInput} type="file" onChange={() => setDirty(true)} />
            </label>
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

        {asset && (
          <p className="hint">
            <a href={api.mediaFileUrl(asset.id, "original")} target="_blank" rel="noreferrer">
              Открыть оригинал
            </a>
          </p>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </Modal>
  );
}
