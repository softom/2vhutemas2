/**
 * Места объекта в редакторе: список прикреплённых и две кнопки (правило 15).
 *
 * Формы здесь нет: «Прикрепить» открывает окно поиска, «Создать» — окно
 * места, щелчок по прикреплённому — то же окно места в режиме правки.
 */
import { useState } from "react";
import { api, type EntityPlace, placeLabel, type Place } from "../api";
import { PlaceDialog } from "./PlaceDialog";
import { PlacePicker } from "./PlacePicker";

interface Props {
  entityId: number | null;
  places: EntityPlace[];
  onChanged: () => void;
}

type Dialog =
  | { kind: "none" }
  | { kind: "picker" }
  | { kind: "create"; role: string }
  | { kind: "edit"; place: Place };

export function PlacesField({ entityId, places, onChanged }: Props) {
  const [dialog, setDialog] = useState<Dialog>({ kind: "none" });
  const [error, setError] = useState<string | null>(null);

  const requireSaved = (): boolean => {
    if (entityId) return true;
    setError("Сначала сохраните объект — место прикрепляется к существующей карточке");
    return false;
  };

  const attach = async (placeId: string, role: string) => {
    await api.attachPlace({ entity_id: entityId, role, place_id: placeId });
    onChanged();
  };

  return (
    <div className="places-field">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <h3>Места</h3>
        <div className="row">
          <button
            type="button"
            className="ghost"
            onClick={() => requireSaved() && setDialog({ kind: "picker" })}
          >
            Прикрепить
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => requireSaved() && setDialog({ kind: "create", role: "address" })}
          >
            Создать
          </button>
        </div>
      </div>
      <p className="hint">
        Одно место может быть адресом объекта, местом рождения, захоронением или офисом —
        смысл задаёт роль привязки. Щелчок по месту открывает его для правки.
      </p>

      {error && <p className="error">{error}</p>}
      {places.length === 0 && <p className="notice">Мест пока нет.</p>}

      <ul className="panel-list">
        {places.map((place) => (
          <li key={place.attachment_id}>
            <button
              type="button"
              className="panel-item-main linklike"
              onClick={() => setDialog({ kind: "edit", place: place as unknown as Place })}
            >
              <span className="panel-item-title">{place.role_title}: {placeLabel(place)}</span>
              <span className="panel-item-sub">
                {place.lat !== null && place.lat !== undefined
                  ? `${place.lat}, ${place.lon}`
                  : "без координат"}
              </span>
            </button>
            <div className="panel-item-actions">
              <button
                type="button"
                className="ghost"
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

      {dialog.kind === "picker" && (
        <PlacePicker
          onAttach={attach}
          onCreateNew={(role) => setDialog({ kind: "create", role })}
          onClose={() => setDialog({ kind: "none" })}
        />
      )}

      {dialog.kind === "create" && (
        <PlaceDialog
          title="Новое место"
          onSaved={async (placeId) => {
            await attach(placeId, dialog.role);
          }}
          onClose={() => setDialog({ kind: "none" })}
        />
      )}

      {dialog.kind === "edit" && (
        <PlaceDialog
          place={dialog.place}
          onSaved={() => onChanged()}
          onClose={() => setDialog({ kind: "none" })}
        />
      )}
    </div>
  );
}
