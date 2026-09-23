/**
 * Места объекта: поиск по справочнику, создание нового, привязка с ролью.
 *
 * Решение Р-25: смысл задаёт роль привязки, а не сама запись. Поэтому роль
 * выбирается здесь, а место переиспользуется — сначала ищем, и только если
 * не нашли, заводим новое.
 */
import { useEffect, useState } from "react";
import { api, type Capabilities, type EntityPlace, type Place } from "../api";

interface Props {
  entityId: number | null;
  places: EntityPlace[];
  onChanged: () => void;
}

const PRECISIONS = [
  { code: "point", title: "Точка" },
  { code: "building", title: "Здание" },
  { code: "settlement", title: "Населённый пункт" },
  { code: "region", title: "Область" },
];

export function PlacesField({ entityId, places, onChanged }: Props) {
  const [roles, setRoles] = useState<{ code: string; title_ru: string }[]>([]);
  const [role, setRole] = useState("address");
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Place[]>([]);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({
    title: "",
    address_line: "",
    settlement: "",
    country: "",
    lat: "",
    lon: "",
    precision: "settlement",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.capabilities()
      .then((caps: Capabilities) => setRoles(caps.dictionaries.place_roles ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (query.trim().length < 2) {
      setFound([]);
      return;
    }
    const timer = setTimeout(() => {
      api.places(query.trim()).then((page) => setFound(page.items)).catch(() => setFound([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const attach = async (body: Record<string, unknown>) => {
    if (!entityId) {
      setError("Сначала сохраните объект — место привязывается к существующей карточке");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.attachPlace({ entity_id: entityId, role, ...body });
      setQuery("");
      setFound([]);
      setCreating(false);
      setDraft({
        title: "",
        address_line: "",
        settlement: "",
        country: "",
        lat: "",
        lon: "",
        precision: "settlement",
      });
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const describe = (place: Place) =>
    [place.address_line, place.settlement, place.country].filter(Boolean).join(", ");

  return (
    <div className="places-field">
      <h3>Места</h3>
      <p className="hint">
        Одно место может быть адресом объекта, местом рождения, захоронением или офисом —
        смысл задаёт роль привязки.
      </p>

      {places.length > 0 && (
        <ul className="panel-list">
          {places.map((place) => (
            <li key={place.attachment_id}>
              <div className="panel-item-main">
                <span className="panel-item-title">
                  {place.role_title}: {place.title}
                </span>
                <span className="panel-item-sub">
                  {describe(place)}
                  {place.lat !== null && ` · ${place.lat?.toFixed(4)}, ${place.lon?.toFixed(4)}`}
                </span>
              </div>
              <div className="panel-item-actions">
                <button
                  type="button"
                  className="ghost"
                  disabled={busy}
                  onClick={async () => {
                    await api.detachPlace(place.attachment_id);
                    onChanged();
                  }}
                >
                  Отвязать
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="row" style={{ marginTop: 10 }}>
        <label>
          Роль
          <select value={role} onChange={(event) => setRole(event.target.value)}>
            {roles.map((item) => (
              <option key={item.code} value={item.code}>{item.title_ru}</option>
            ))}
          </select>
        </label>
        <label style={{ flex: 1, minWidth: 220 }}>
          Найти место
          <input
            value={query}
            placeholder="Сиань, Красный проспект"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>

      {found.length > 0 && (
        <ul className="panel-list">
          {found.map((place) => (
            <li key={place.id}>
              <div className="panel-item-main">
                <span className="panel-item-title">{place.title}</span>
                <span className="panel-item-sub">{describe(place)}</span>
              </div>
              <div className="panel-item-actions">
                <button
                  type="button"
                  className="ghost"
                  disabled={busy}
                  onClick={() => attach({ place_id: place.id })}
                >
                  Привязать
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="error">{error}</p>}

      {!creating
        ? (
          <button
            type="button"
            className="ghost"
            style={{ marginTop: 10 }}
            onClick={() => {
              setCreating(true);
              setDraft({ ...draft, title: query });
            }}
          >
            Место не нашлось — создать новое
          </button>
        )
        : (
          <div className="form" style={{ marginTop: 12 }}>
            <label>
              Название места
              <input
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              />
              <span className="hint">«Сиань», «Новосибирский оперный театр»</span>
            </label>
            <label>
              Адрес
              <input
                value={draft.address_line}
                onChange={(event) => setDraft({ ...draft, address_line: event.target.value })}
              />
            </label>
            <div className="row">
              <label>
                Населённый пункт
                <input
                  value={draft.settlement}
                  onChange={(event) => setDraft({ ...draft, settlement: event.target.value })}
                />
              </label>
              <label>
                Страна
                <input
                  value={draft.country}
                  onChange={(event) => setDraft({ ...draft, country: event.target.value })}
                />
              </label>
            </div>
            <div className="row">
              <label>
                Широта
                <input
                  type="number"
                  step="0.000001"
                  value={draft.lat}
                  onChange={(event) => setDraft({ ...draft, lat: event.target.value })}
                />
              </label>
              <label>
                Долгота
                <input
                  type="number"
                  step="0.000001"
                  value={draft.lon}
                  onChange={(event) => setDraft({ ...draft, lon: event.target.value })}
                />
              </label>
              <label>
                Точность
                <select
                  value={draft.precision}
                  onChange={(event) => setDraft({ ...draft, precision: event.target.value })}
                >
                  {PRECISIONS.map((item) => (
                    <option key={item.code} value={item.code}>{item.title}</option>
                  ))}
                </select>
                <span className="hint">Как точно известно положение</span>
              </label>
            </div>
            <div className="row">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  attach({
                    place: {
                      title: draft.title,
                      address_line: draft.address_line || null,
                      settlement: draft.settlement || null,
                      country: draft.country || null,
                      lat: draft.lat === "" ? null : Number(draft.lat),
                      lon: draft.lon === "" ? null : Number(draft.lon),
                      precision: draft.precision,
                    },
                  })}
              >
                Создать и привязать
              </button>
              <button type="button" className="ghost" onClick={() => setCreating(false)}>
                Отмена
              </button>
            </div>
          </div>
        )}
    </div>
  );
}
