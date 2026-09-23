/**
 * Медиатека: загрузка файла со сведениями о происхождении и правка карточки файла.
 *
 * Автор изображения, где хранится оригинал и подпись источника важны не меньше
 * самого файла: без них иллюстрацию нельзя честно опубликовать.
 */
import { useEffect, useRef, useState } from "react";
import { api, type Capabilities, type MediaAsset } from "../api";

interface Meta {
  kind: string;
  caption: string;
  description: string;
  author: string;
  credit: string;
  source_url: string;
  license: string;
  created_year: string;
  created_note: string;
  holder: string;
  inventory_no: string;
  original_caption: string;
  keywords: string;
  alt: string;
  visibility: string;
}

const EMPTY: Meta = {
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

export function MediaLibrary({ canUpload }: { canUpload: boolean }) {
  const [items, setItems] = useState<MediaAsset[]>([]);
  const [kinds, setKinds] = useState<{ code: string; title_ru: string }[]>([]);
  const [meta, setMeta] = useState<Meta>(EMPTY);
  const [selected, setSelected] = useState<MediaAsset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const reload = () =>
    api.media().then((page) => setItems(page.items)).catch((e) => setError(e.message));

  useEffect(() => {
    reload();
    api.capabilities()
      .then((caps: Capabilities) => setKinds(caps.dictionaries.media_kinds ?? []))
      .catch(() => {});
  }, []);

  const upload = async () => {
    const file = fileInput.current?.files?.[0];
    if (!file) {
      setError("Сначала выберите файл");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("caption", meta.caption || file.name);
      for (const [key, value] of Object.entries(meta)) {
        if (key !== "caption" && value) form.append(key, value);
      }
      await api.uploadMedia(form);
      setMeta(EMPTY);
      if (fileInput.current) fileInput.current.value = "";
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const field = (name: keyof Meta, label: string, hint?: string) => (
    <label>
      {label}
      <input value={meta[name]} onChange={(e) => setMeta({ ...meta, [name]: e.target.value })} />
      {hint && <span className="hint">{hint}</span>}
    </label>
  );

  return (
    <section>
      <h1>Медиатека</h1>
      <p className="sub">
        Оригинал хранится неизменным, экранная версия и превью создаются сразу.
      </p>

      {canUpload && (
        <details className="uploader" open>
          <summary>Загрузить файл</summary>
          <div className="form">
            <label>
              Файл
              <input ref={fileInput} type="file" disabled={busy} />
            </label>
            <div className="row">
              <label>
                Вид изображения
                <select
                  value={meta.kind}
                  onChange={(e) => setMeta({ ...meta, kind: e.target.value })}
                >
                  {kinds.map((k) => <option key={k.code} value={k.code}>{k.title_ru}</option>)}
                </select>
              </label>
              <label>
                Доступ
                <select
                  value={meta.visibility}
                  onChange={(e) => setMeta({ ...meta, visibility: e.target.value })}
                >
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
            <div className="row">
              <button type="button" onClick={upload} disabled={busy}>
                {busy ? "Загружаем и обрабатываем…" : "Загрузить"}
              </button>
            </div>
          </div>
        </details>
      )}

      {error && <p className="error">{error}</p>}
      {items.length === 0 && <p className="notice">Файлов пока нет.</p>}

      <div className="grid">
        {items.map((asset) => {
          const files = asset.files ?? {};
          const thumb = files.thumbnail;
          const extra = asset as unknown as {
            kind?: string;
            author?: string;
            holder?: string;
            created_year?: number;
          };
          return (
            <button
              type="button"
              className="card"
              key={asset.id}
              onClick={() => setSelected(asset)}
              style={{ textAlign: "left", background: "var(--surface)", color: "inherit" }}
            >
              {thumb?.status === "ready"
                ? <img src={api.mediaFileUrl(asset.id, "thumbnail")} alt={asset.caption_ru ?? ""} />
                : <div className="notice" style={{ height: 150 }}>обработка…</div>}
              <div className="title" style={{ fontSize: 15 }}>
                {asset.caption_ru ?? "без подписи"}
              </div>
              <div className="kind">
                {[extra.kind, extra.created_year, extra.author, extra.holder]
                  .filter(Boolean).join(" · ") || asset.asset_class}
              </div>
            </button>
          );
        })}
      </div>

      {selected && (
        <AssetDetails
          asset={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}

function AssetDetails({ asset, onClose }: { asset: MediaAsset; onClose: () => void }) {
  const extra = asset as unknown as Record<string, unknown>;
  const rows: [string, unknown][] = [
    ["Вид", extra.kind],
    ["Описание", extra.description],
    ["Автор изображения", extra.author],
    ["Атрибуция", asset.credit],
    ["Год съёмки", extra.created_year],
    ["Где хранится", extra.holder],
    ["Ключевые слова", Array.isArray(extra.keywords) ? extra.keywords.join(", ") : null],
    ["Доступ", asset.visibility === "public" ? "публичный" : "приватный"],
  ];
  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>{asset.caption_ru ?? "Файл"}</h2>
        <button type="button" className="ghost" onClick={onClose}>Закрыть</button>
      </div>
      <img
        src={api.mediaFileUrl(asset.id, "screen")}
        alt={asset.caption_ru ?? ""}
        style={{ width: "100%", borderRadius: 8, margin: "12px 0" }}
      />
      <dl className="facts">
        {rows.filter(([, value]) => value !== null && value !== undefined && value !== "").map((
          [label, value],
        ) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{String(value)}</dd>
          </div>
        ))}
      </dl>
      <a href={api.mediaFileUrl(asset.id, "original")} target="_blank" rel="noreferrer">
        Открыть оригинал
      </a>
    </div>
  );
}
