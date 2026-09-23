/**
 * Окно «Прикрепить место»: поиск по справочнику и выбор роли (правило 15).
 *
 * Место сначала ищут и переиспользуют; новое заводится только если нужного
 * не нашлось — тогда открывается окно места, а роль берётся отсюда.
 */
import { useEffect, useState } from "react";
import { api, type Capabilities, placeLabel, type Place } from "../api";
import { Modal } from "../ui/Modal";

interface Props {
  onAttach: (placeId: string, role: string) => Promise<void>;
  onCreateNew: (role: string) => void;
  onClose: () => void;
}

export function PlacePicker({ onAttach, onCreateNew, onClose }: Props) {
  const [roles, setRoles] = useState<{ code: string; title_ru: string }[]>([]);
  const [role, setRole] = useState("address");
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Place[]>([]);
  const [busy, setBusy] = useState(false);
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

  return (
    <Modal
      title="Прикрепить место"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={() => onCreateNew(role)}>Место не нашлось — создать</button>
          <button type="button" className="ghost" onClick={onClose}>Отмена</button>
        </>
      }
    >
      <div className="form">
        <div className="row">
          <label>
            Роль
            <select value={role} onChange={(event) => setRole(event.target.value)}>
              {roles.map((item) => (
                <option key={item.code} value={item.code}>{item.title_ru}</option>
              ))}
            </select>
            <span className="hint">Чем это место будет для объекта</span>
          </label>
          <label style={{ flex: 1, minWidth: 220 }}>
            Поиск
            <input
              autoFocus
              value={query}
              placeholder="Новосибирск, Красный проспект"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>

        {error && <p className="error">{error}</p>}
        {found.length === 0 && <p className="notice">Ничего не нашлось.</p>}

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
                <button
                  type="button"
                  className="ghost"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError(null);
                    try {
                      await onAttach(place.id, role);
                      onClose();
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Прикрепить
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
