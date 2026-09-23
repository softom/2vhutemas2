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

const EMPTY = {
  kind: "photo",
  caption: "",
  description: "",
  author: "",
  credit: "",
  source_url: "",
  license: "",
  created_year: "",
  created_note: "",
  holder: "",
  inventory_no: "",
  original_caption: "",
  keywords: "",
  alt: "",
  visibility: "private",
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
    description: (extra.description as string) ?? "",
    author: (extra.author as string) ?? "",
    credit: asset.credit ?? "",
    source_url: (extra.source_url as string) ?? "",
    license: (extra.license_code as string) ?? "",
    created_year: extra.created_year ? String(extra.created_year) : "",
    created_note: (extra.created_note as string) ?? "",
    holder: (extra.holder as string) ?? "",
    inventory_no: (extra.inventory_no as string) ?? "",
    original_caption: (extra.original_caption as string) ?? "",
    keywords: Array.isArray(extra.keywords) ? (extra.keywords as string[]).join(", ") : "",
    alt: (extra.alt_text as string) ?? "",
    visibility: asset.visibility ?? "private",
  };
}

export function MediaDialog({ asset, onSaved, onClose }: Props) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(asset));
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
          alt: draft.alt || null,
          description: draft.description || null,
          author: draft.author || null,
          credit: draft.credit || null,
          source_url: draft.source_url || null,
          license: draft.license || null,
          created_year: draft.created_year === "" ? null : Number(draft.created_year),
          created_note: draft.created_note || null,
          holder: draft.holder || null,
          inventory_no: draft.inventory_no || null,
          original_caption: draft.original_caption || null,
          keywords: draft.keywords
            ? draft.keywords.split(",").map((k) => k.trim()).filter(Boolean)
            : null,
          visibility: draft.visibility,
        });
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

        <div className="row">
          <label>
            Вид изображения
            <select value={draft.kind} onChange={(event) => set("kind", event.target.value)}>
              {kinds.map((item) => <option key={item.code} value={item.code}>{item.title_ru}</option>)}
            </select>
          </label>
          <label>
            Доступ
            <select value={draft.visibility} onChange={(event) => set("visibility", event.target.value)}>
              <option value="private">Приватный</option>
              <option value="public">Публичный</option>
            </select>
          </label>
        </div>

        {field("caption", "Подпись", "Как подписываем изображение у себя")}
        {field("description", "Описание", "Что именно изображено")}
        <div className="row">
          {field("author", "Автор изображения", "Фотограф, чертёжник")}
          {field("credit", "Атрибуция", "Как требует указывать правообладатель")}
        </div>
        <div className="row">
          {field("created_year", "Год съёмки")}
          {field("created_note", "Уточнение даты", "«около 1930», «до перестройки»")}
        </div>
        <div className="row">
          {field("holder", "Где хранится", "Архив, музей, собрание")}
          {field("inventory_no", "Инвентарный номер")}
        </div>
        {field("original_caption", "Подпись источника", "Дословно, как в источнике")}
        <div className="row">
          {field("source_url", "Ссылка на источник")}
          {field("license", "Лицензия")}
        </div>
        {field("keywords", "Ключевые слова", "Через запятую")}
        {field("alt", "Альтернативный текст", "Для тех, кто не видит изображение")}

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
