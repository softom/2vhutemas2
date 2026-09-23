/**
 * Окно места: создание и правка (правило 15, решение Р-26).
 *
 * Место общее для всех объектов, где оно прикреплено, поэтому при правке
 * окно показывает, где оно используется: менять сведения вслепую нельзя.
 */
import { useEffect, useState } from "react";
import { api, placeLabel, type Place } from "../api";
import { Modal } from "../ui/Modal";

const PRECISIONS = [
  { code: "point", title: "Точка" },
  { code: "building", title: "Здание" },
  { code: "settlement", title: "Населённый пункт" },
  { code: "region", title: "Область" },
];

const EMPTY = {
  country: "",
  settlement: "",
  street: "",
  house: "",
  unit: "",
  lat: "",
  lon: "",
  precision: "settlement",
  source_url: "",
};

type Draft = typeof EMPTY;

interface Props {
  /** Пусто — создание нового места. */
  place?: Place | null;
  /** Заголовок подставляется сам, но можно уточнить. */
  title?: string;
  onSaved: (placeId: string, draft: Draft) => void | Promise<void>;
  onClose: () => void;
}

function toDraft(place?: Place | null): Draft {
  if (!place) return { ...EMPTY };
  return {
    country: place.country ?? "",
    settlement: place.settlement ?? "",
    street: place.street ?? "",
    house: place.house ?? "",
    unit: place.unit ?? "",
    lat: place.lat === null || place.lat === undefined ? "" : String(place.lat),
    lon: place.lon === null || place.lon === undefined ? "" : String(place.lon),
    precision: place.precision ?? "settlement",
    source_url: (place as unknown as { source_url?: string }).source_url ?? "",
  };
}

export function PlaceDialog({ place, title, onSaved, onClose }: Props) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(place));
  const [usage, setUsage] = useState<{ id: number; title_ru: string; role_title: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!place?.id) return;
    api.placeUsage(place.id)
      .then((page) => setUsage(page.items as typeof usage))
      .catch(() => setUsage([]));
  }, [place?.id]);

  const set = (name: keyof Draft, value: string) => {
    setDraft({ ...draft, [name]: value });
    setDirty(true);
  };

  const field = (name: keyof Draft, label: string, hint?: string, extra?: Record<string, unknown>) => (
    <label>
      {label}
      <input value={draft[name]} onChange={(event) => set(name, event.target.value)} {...extra} />
      {hint && <span className="hint">{hint}</span>}
    </label>
  );

  const payload = () => ({
    country: draft.country || null,
    settlement: draft.settlement || null,
    street: draft.street || null,
    house: draft.house || null,
    unit: draft.unit || null,
    lat: draft.lat === "" ? null : Number(draft.lat),
    lon: draft.lon === "" ? null : Number(draft.lon),
    precision: draft.precision,
    source_url: draft.source_url || null,
  });

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (place?.id) {
        await api.updatePlace(place.id, payload());
        await onSaved(place.id, draft);
      } else {
        const created = await api.createPlace(payload());
        await onSaved(created.id, draft);
      }
      setDirty(false);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={title ?? (place?.id ? "Редактирование места" : "Новое место")}
      dirty={dirty}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={save} disabled={busy}>
            {busy ? "Сохраняем…" : place?.id ? "Сохранить" : "Создать"}
          </button>
          <button type="button" className="ghost" onClick={onClose}>Отмена</button>
        </>
      }
    >
      {usage.length > 0 && (
        <p className="notice">
          Место используется: {usage.map((item) => `${item.title_ru} (${item.role_title})`).join(", ")}.
          Правка изменит сведения везде.
        </p>
      )}

      <div className="form">
        <p className="hint">Заполняется то, что известно. Пустая запись не создаётся.</p>
        <div className="row">
          {field("country", "Страна")}
          {field("settlement", "Населённый пункт")}
        </div>
        <div className="row">
          <label style={{ flex: 2, minWidth: 200 }}>
            Улица
            <input value={draft.street} onChange={(event) => set("street", event.target.value)} />
          </label>
          <label style={{ maxWidth: 120 }}>
            Дом
            <input value={draft.house} onChange={(event) => set("house", event.target.value)} />
          </label>
          <label style={{ maxWidth: 140 }}>
            Помещение
            <input value={draft.unit} onChange={(event) => set("unit", event.target.value)} />
          </label>
        </div>
        <div className="row">
          {field("lat", "Широта", undefined, { type: "number", step: "0.000001" })}
          {field("lon", "Долгота", undefined, { type: "number", step: "0.000001" })}
          <label>
            Точность
            <select value={draft.precision} onChange={(event) => set("precision", event.target.value)}>
              {PRECISIONS.map((item) => (
                <option key={item.code} value={item.code}>{item.title}</option>
              ))}
            </select>
            <span className="hint">Как точно известно положение</span>
          </label>
        </div>
        {field("source_url", "Источник сведений", "Ссылка, откуда взято положение")}
        {(draft.country || draft.settlement || draft.street) && (
          <p className="hint">Подпись: {placeLabel(payload() as unknown as Place)}</p>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </Modal>
  );
}
