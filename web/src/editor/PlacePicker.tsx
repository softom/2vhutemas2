/**
 * Окно «Выбрать место»: поиск по справочнику (правило 15).
 *
 * Место сначала ищут и переиспользуют; новое заводится только если нужного
 * не нашлось. Роль места больше не спрашивается здесь: чем место служит
 * записи, определяет параметр — «адрес объекта», «место рождения» (Р-39).
 */
import { useEffect, useState } from "react";
import { api, placeLabel, type Place } from "../api";
import { Modal } from "../ui/Modal";

interface Props {
  onPick: (placeId: string) => void;
  onCreateNew: () => void;
  onClose: () => void;
}

export function PlacePicker({ onPick, onCreateNew, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Place[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      api.places(query.trim())
        .then((page) => setFound(page.items))
        .catch((e) => {
          setFound([]);
          setError((e as Error).message);
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <Modal
      title="Выбрать место"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onCreateNew}>Место не нашлось — создать</button>
          <button type="button" className="ghost" onClick={onClose}>Отмена</button>
        </>
      }
    >
      <div className="form">
        <label>
          Поиск
          <input
            autoFocus
            value={query}
            placeholder="Новосибирск, Красный проспект"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

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
                  onClick={() => {
                    onPick(place.id);
                    onClose();
                  }}
                >
                  Выбрать
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
