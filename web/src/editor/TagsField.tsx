/**
 * Метки: ввод по «#» с подсказкой из общего справочника.
 *
 * Набор сужает список; выбор из списка берёт слово из справочника, новое
 * слово его пополняет. Так «Сиань» и «сиань» не расходятся в две метки.
 */
import { useEffect, useRef, useState } from "react";
import { api } from "../api";

export interface Tag {
  id: string;
  title: string;
}

interface Props {
  value: Tag[];
  onChange: (tags: Tag[]) => void;
  hint?: string;
}

export function TagsField({ value, onChange, hint }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<{ id: string; title: string; usages: number }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const term = query.replace(/^#/, "").trim();

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      api.tags(term).then((page) => setSuggestions(page.items)).catch(() => setSuggestions([]));
    }, 200);
    return () => clearTimeout(timer);
  }, [term, open]);

  const add = (tag: Tag) => {
    if (!value.some((item) => item.title.toLowerCase() === tag.title.toLowerCase())) {
      onChange([...value, tag]);
    }
    setQuery("");
    setOpen(false);
    inputRef.current?.focus();
  };

  const remove = (title: string) =>
    onChange(value.filter((item) => item.title !== title));

  const visible = suggestions.filter(
    (item) => !value.some((chosen) => chosen.title.toLowerCase() === item.title.toLowerCase()),
  );

  return (
    <div className="tags-field">
      <div className="tags-chips">
        {value.map((tag) => (
          <span className="tag-chip" key={tag.title}>
            #{tag.title}
            <button type="button" onClick={() => remove(tag.title)} aria-label="Убрать метку">✕</button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={query}
          placeholder={value.length === 0 ? "# метка" : "#"}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && term) {
              event.preventDefault();
              // Новое слово пополняет справочник при сохранении записи.
              add({ id: "", title: term });
            }
            if (event.key === "Backspace" && query === "" && value.length > 0) {
              remove(value[value.length - 1].title);
            }
            if (event.key === "Escape") setOpen(false);
          }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
      </div>
      {hint && <span className="hint">{hint}</span>}

      {open && (
        <ul className="tags-suggest">
          {visible.map((item) => (
            <li key={item.id}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => add(item)}>
                #{item.title}
                <span className="tag-usages">{item.usages}</span>
              </button>
            </li>
          ))}
          {term && !visible.some((item) => item.title.toLowerCase() === term.toLowerCase()) && (
            <li>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => add({ id: "", title: term })}
              >
                Новая метка: #{term}
              </button>
            </li>
          )}
          {visible.length === 0 && !term && <li className="hint">Справочник пока пуст</li>}
        </ul>
      )}
    </div>
  );
}
