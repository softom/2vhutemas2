/**
 * Всплывающее окно — общий вид для всех универсальных элементов (правило 15).
 *
 * Одно окно на создание и правку: различается только заполненность полей.
 * Закрывается по Esc и по щелчку вне окна; случайное закрытие с потерей
 * введённого недопустимо, поэтому при наличии изменений спрашиваем.
 */
import { type ReactNode, useEffect } from "react";

interface Props {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  dirty?: boolean;
  onClose: () => void;
}

export function Modal({ title, children, footer, dirty, onClose }: Props) {
  const close = () => {
    if (dirty && !confirm("Закрыть окно? Несохранённые изменения пропадут.")) return;
    onClose();
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  });

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <div className="modal" role="dialog" aria-label={title}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="ghost" onClick={close} aria-label="Закрыть">✕</button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}
