import { useRef, useState } from "react";

/** Local draft: typing does not redraw the news table or open native popup windows. */
export function PositiveReason({ title, reasons, initialNote, judged, submit }: {
  title: string; reasons: readonly string[]; initialNote: string; judged: boolean;
  submit: (reason: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const [draft, setDraft] = useState(initialNote);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const send = async (reason: string) => {
    if (sending.current || !reason.trim()) return;
    sending.current = true; setBusy(true);
    try { await submit(reason.trim()); setOpen(false); }
    finally { sending.current = false; setBusy(false); }
  };
  return <div aria-label={`Положительная оценка: ${title}`}>
    <button type="button" className="ghost" aria-expanded={open} onClick={() => setOpen(!open)} disabled={busy}>
      {judged ? "Оценено положительно · причина…" : "Выпустил бы, потому что…"}
    </button>
    {open && <div className="block" style={{ padding: "0.5rem", minWidth: "15rem" }}>
      {reasons.map(reason => <p key={reason}><button type="button" className="ghost" disabled={busy} onClick={() => void send(reason)}>{reason}</button></p>)}
      <button type="button" className="ghost" aria-expanded={custom} disabled={busy} onClick={() => setCustom(!custom)}>Своя причина</button>
      {custom && <div>
        <label>Почему выпустили бы<textarea value={draft} rows={3} style={{ width: "100%" }} onChange={e => setDraft(e.target.value)} disabled={busy} /></label>
        <button type="button" disabled={busy || !draft.trim()} onClick={() => void send(draft)}>Сохранить положительную оценку</button>
      </div>}
      {busy && <p role="status">Сохраняем…</p>}
    </div>}
  </div>;
}
