/**
 * Заставка: обложка проекта на входе (решение Р-58).
 *
 * Показывается только тому, кто открыл сайт с корня, и только на первой
 * отрисовке страницы: переходы внутри сайта её не повторяют. Держится
 * около трёх секунд и уступает место содержимому; щелчок, клавиша или
 * прокрутка обрывают её сразу — ждать никого не заставляем.
 *
 * Обложка рисуется поверх приложения, а не вместо него: пока человек
 * смотрит знак, каталог за ней успевает загрузиться.
 */
import { useEffect, useState } from "react";
import { buildCover, COVER_DEFAULTS } from "../about/vh2Cover";
import { FONTS, type GlyphFont } from "../about/vh2Sign";

/** Сколько держим обложку и сколько длится уход. */
const HOLD = 2400;
const FADE = 420;

export function Splash({ onDone }: { onDone: () => void }) {
  const [svg, setSvg] = useState("");
  const [leaving, setLeaving] = useState(false);

  // Шрифт обложки — тот же, что в конструкторе знака: широкий геометрический.
  useEffect(() => {
    let alive = true;
    const entry = FONTS.find((f) => f.key === "montserrat") ?? FONTS[0];
    entry.load()
      .then((font: GlyphFont) => { if (alive) setSvg(buildCover(COVER_DEFAULTS, font)); })
      // Не нарисовали знак — заставка просто уйдёт по времени, сайт не пострадает.
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    // Уход по времени и уход по первому действию человека — одно и то же.
    const leave = () => setLeaving(true);
    const hold = setTimeout(leave, HOLD);
    for (const event of ["pointerdown", "keydown", "wheel", "touchstart"]) {
      globalThis.addEventListener(event, leave, { passive: true });
    }
    return () => {
      clearTimeout(hold);
      for (const event of ["pointerdown", "keydown", "wheel", "touchstart"]) {
        globalThis.removeEventListener(event, leave);
      }
    };
  }, []);

  useEffect(() => {
    if (!leaving) return;
    const gone = setTimeout(onDone, FADE);
    return () => clearTimeout(gone);
  }, [leaving, onDone]);

  return (
    <div className={leaving ? "splash leaving" : "splash"} aria-hidden="true">
      {svg && <div className="splash-sheet" dangerouslySetInnerHTML={{ __html: svg }} />}
    </div>
  );
}
