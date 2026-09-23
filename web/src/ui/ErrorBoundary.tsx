/**
 * Перехват ошибок отрисовки.
 *
 * Без него любая ошибка внутри страницы даёт пустой чёрный экран без
 * объяснения: человек не понимает, сломалось приложение или его материал.
 * Показываем, что произошло, и оставляем выход.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Ошибка отрисовки:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <section>
        <h1>Страница не открылась</h1>
        <p className="error">{this.state.error.message}</p>
        <p className="notice">
          Материал сохранён — ошибка произошла при показе, а не при записи.
          Сообщите об этом: в журнале сервиса есть подробности.
        </p>
        <div className="row">
          <button type="button" onClick={() => location.reload()}>Обновить страницу</button>
          <a href="/new/"><button type="button" className="ghost">В каталог</button></a>
        </div>
      </section>
    );
  }
}
