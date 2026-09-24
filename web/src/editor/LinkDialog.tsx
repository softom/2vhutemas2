/**
 * Окно связи: связать запись с другой и объяснить, на каком основании.
 *
 * Связь не существует без обоснования — это правило держит и база (Р-23).
 * Поэтому окно требует текст: не «подтвердите», а «объясните».
 *
 * Вставка в текст связью не является: там остаётся ссылка на запись и её
 * отображение. Здесь — утверждение об отношении двух записей.
 */
import { useEffect, useState } from "react";
import { api, type Capabilities } from "../api";
import { Modal } from "../ui/Modal";

interface Props {
  fromEntityId: number;
  toEntityId: number;
  toTitle: string;
  onLinked: () => void;
  onClose: () => void;
}

export function LinkDialog({ fromEntityId, toEntityId, toTitle, onLinked, onClose }: Props) {
  const [roles, setRoles] = useState<{ code: string; title_ru: string }[]>([]);
  const [role, setRole] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.capabilities()
      .then((caps: Capabilities) => setRoles(caps.dictionaries.link_roles ?? []))
      .catch(() => {});
  }, []);

  const save = async () => {
    if (!text.trim()) {
      setError("Связь не сохраняется без объяснения, на каком она основании");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.createLink({
        from_entity_id: fromEntityId,
        to_entity_id: toEntityId,
        role: role || null,
        justification: { text: text.trim() },
      });
      onLinked();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`Связать с «${toTitle}»`}
      dirty={text.trim().length > 0}
      onClose={onClose}
      footer={
        <>
          <button type="button" disabled={saving} onClick={save}>Связать</button>
          <button type="button" className="ghost" onClick={onClose}>Отмена</button>
        </>
      }
    >
      <div className="form">
        {error && <p className="error">{error}</p>}

        <label>
          Роль связи
          <select value={role} onChange={(event) => setRole(event.target.value)}>
            <option value="">без роли</option>
            {roles.map((item) => (
              <option key={item.code} value={item.code}>{item.title_ru}</option>
            ))}
          </select>
          <span className="hint">Кем или чем одна запись приходится другой</span>
        </label>

        <label>
          На каком основании
          <textarea
            autoFocus
            rows={4}
            value={text}
            placeholder="Мейерхольд участвовал в разработке сценической системы «Теомасс» — переписка 1930 года"
            onChange={(event) => setText(event.target.value)}
          />
          <span className="hint">
            Связать можно что угодно с чем угодно; свобода оплачивается обязанностью объяснить
          </span>
        </label>
      </div>
    </Modal>
  );
}
