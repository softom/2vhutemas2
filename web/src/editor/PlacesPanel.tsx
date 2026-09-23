/**
 * Панель мест справа от блока мест: поиск, прикрепление, создание.
 *
 * Панель стоит напротив своего раздела, как и панели объектов и файлов
 * напротив текста: у каждого уровня карточки свои прикрепления.
 */
import { useEffect, useState } from "react";
import { api, type Capabilities, placeLabel, type Place } from "../api";
import { PlaceDialog } from "./PlaceDialog";

interface Props {
  entityId: number | null;
  onChanged: () => void;
}

export function PlacesPanel({ entityId, onChanged }: Props) {
  const [roles, setRoles] = useState<{ code: string; title_ru: string }[]>([]);
  const [role, setRole] = useState("address");
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Place[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.capabilities()
      .then((caps: Capabilities) => setRoles(caps.dictionaries.place_roles ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      api.places(query.trim()).then((page) => setFound(page.items)).catch(() => setFound([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const attach = async (placeId: string) => {
    if (!entityId) {
      setError("Сначала сохраните объект");
      return;
    }
    setError(null);
    try {
      await api.attachPlace({ entity_id: entityId, role, place_id: placeId });
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <aside className="entity-panel">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <h3>Адреса</h3>
        <button type="button" className="ghost" onClick={() => setCreating(true)}>Создать</button>
      </div>
      <p className="hint">Найдите место в справочнике и прикрепите с нужной ролью.</p>

      <label>
        Роль
        <select value={role} onChange={(event) => setRole(event.target.value)}>
          {roles.map((item) => <option key={item.code} value={item.code}>{item.title_ru}</option>)}
        </select>
      </label>
      <input
        placeholder="Поиск: город, улица"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      {error && <p className="error">{error}</p>}
      {found.length === 0 && <p className="hint">Ничего не нашлось.</p>}

      <ul className="panel-list">
        {found.map((place) => (
          <li key={place.id}>
            <div className="panel-item-main">
              <span className="panel-item-title">{placeLabel(place)}</span>
              <span className="panel-item-sub">
                {place.lat !== null ? `${place.lat}, ${place.lon}` : "без координат"}
              </span>
            </div>
            <div className="panel-item-actions">
              <button type="button" className="ghost" onClick={() => attach(place.id)}>
                Прикрепить
              </button>
            </div>
          </li>
        ))}
      </ul>

      {creating && (
        <PlaceDialog
          title="Новое место"
          onSaved={async (placeId) => {
            await attach(placeId);
          }}
          onClose={() => setCreating(false)}
        />
      )}
    </aside>
  );
}
