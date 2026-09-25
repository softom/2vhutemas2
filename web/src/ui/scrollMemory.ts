/**
 * Память положения на странице.
 *
 * Лекцию читают сверху вниз: щёлкнул по объекту в тексте, посмотрел карточку,
 * вернулся — и должен оказаться там же, откуда ушёл, а не в начале. Браузер
 * сам этого не делает: страница собирается после перехода, и к моменту, когда
 * он восстанавливает положение, содержимого ещё нет.
 *
 * Положение храним в памяти вкладки по адресу страницы. Записываем его при
 * прокрутке — то значение, которое было в момент события. Записывать «текущее»
 * при уходе со страницы нельзя: к этому моменту прокрутка уже сброшена, и ноль
 * затирает запомненное.
 */
import { useEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

const positions = new Map<string, number>();
// Память видна из консоли: без этого разбираться, почему возврат промахнулся,
// приходится вслепую.
(globalThis as unknown as { __scroll?: unknown }).__scroll = positions;
/** Сколько раз проверяем, дорос ли текст до нужной высоты: около 15 секунд. */
const MAX_TICKS = 125;

export function useScrollMemory() {
  const location = useLocation();
  const navigationType = useNavigationType();
  // Ключ — адрес, а не запись истории: ссылка может увести с полной
  // перезагрузкой, и тогда ключ записи истории будет другим.
  const key = location.pathname + location.search;
  const lastScroll = useRef(0);

  useEffect(() => {
    // Берём восстановление на себя: иначе браузер спорит с нами.
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  }, []);

  // Запоминаем положение, пока страница открыта.
  useEffect(() => {
    lastScroll.current = globalThis.scrollY;
    let timer = 0;
    const onScroll = () => {
      const value = globalThis.scrollY;
      lastScroll.current = value;
      clearTimeout(timer);
      timer = setTimeout(() => positions.set(key, value), 120);
    };
    // Щелчок — это почти всегда начало перехода, и в этот момент страница
    // ещё цела. Ловим его до обработчиков приложения: к моменту, когда React
    // разберёт страницу, прокрутка уже сброшена и запоминать нечего.
    const onClick = () => {
      const value = globalThis.scrollY;
      lastScroll.current = value;
      positions.set(key, value);
    };

    globalThis.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      clearTimeout(timer);
      // Уходя, запоминаем, где были. На события прокрутки полагаться нельзя:
      // в неотрисованной вкладке браузер их не шлёт, и память осталась бы
      // пустой. Ноль при уходе — это уже сброс прокрутки, тогда берём
      // последнее замеченное.
      const leaving = globalThis.scrollY;
      positions.set(key, leaving > 0 ? leaving : lastScroll.current);
      // Возврат браузером «назад» тоже приходит сюда: там прокрутка ещё цела.
      globalThis.removeEventListener("scroll", onScroll);
    };
  }, [key]);

  // Возврат назад — восстанавливаем, переход вперёд — начинаем сверху.
  useEffect(() => {
    if (navigationType !== "POP") {
      globalThis.scrollTo(0, 0);
      return;
    }
    const saved = positions.get(key) ?? 0;
    (globalThis as unknown as { __scrollLast?: unknown }).__scrollLast = {
      key,
      saved,
      navigationType,
      at: new Date().toISOString(),
    };
    if (saved < 8) return;

    // Текст лекции рисуется долго: сначала приходит карточка, потом документ,
    // потом догружаются изображения — и каждая порция меняет высоту страницы.
    // Поэтому возвращаемся настойчиво: пробуем, пока не встанем на место
    // или пока человек сам не тронет прокрутку.
    let ticks = 0;
    let touched = false;
    const noteUser = () => {
      touched = true;
    };
    for (const event of ["wheel", "touchstart", "keydown"]) {
      globalThis.addEventListener(event, noteUser, { passive: true });
    }

    const timer = setInterval(() => {
      ticks += 1;
      if (touched || ticks > MAX_TICKS) {
        clearInterval(timer);
        return;
      }
      const reachable = document.documentElement.scrollHeight - globalThis.innerHeight;
      if (reachable < saved - 4) return;
      if (Math.abs(globalThis.scrollY - saved) > 2) {
        globalThis.scrollTo(0, saved);
        lastScroll.current = saved;
      }
    }, 120);

    return () => {
      clearInterval(timer);
      for (const event of ["wheel", "touchstart", "keydown"]) {
        globalThis.removeEventListener(event, noteUser);
      }
    };
  }, [key, navigationType]);
}
