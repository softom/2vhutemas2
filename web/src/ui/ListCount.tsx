/**
 * Счётчик списка: сколько записей показано и есть ли ещё.
 *
 * Списки переросли экран, и без счётчика непонятно, видишь ли ты всё
 * или только первую страницу. Ставится и над списком, и под ним.
 */
interface Props {
  shown: number;
  word: [string, string, string];
  hasMore: boolean;
  onMore?: () => void;
  loading?: boolean;
}

/** «1 запись, 2 записи, 5 записей» — без этого счётчик читается коряво. */
function plural(count: number, [one, few, many]: [string, string, string]): string {
  const tens = count % 100;
  if (tens >= 11 && tens <= 14) return many;
  const ones = count % 10;
  if (ones === 1) return one;
  if (ones >= 2 && ones <= 4) return few;
  return many;
}

export function ListCount({ shown, word, hasMore, onMore, loading }: Props) {
  return (
    <div className="list-count">
      <span className="hint">
        Показано {shown} {plural(shown, word)}
        {hasMore ? " — есть ещё" : ""}
      </span>
      {hasMore && onMore && (
        <button type="button" className="ghost" disabled={loading} onClick={onMore}>
          {loading ? "Загружаем…" : "Показать ещё"}
        </button>
      )}
    </div>
  );
}
