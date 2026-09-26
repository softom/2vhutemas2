/**
 * Обложка проекта — заставка сайта (решение Р-58).
 *
 * Та же проба, что признана удачной в [Р-56]: подпись «ДВА ВХУТЕМАС РУ»,
 * крупный знак Вх² с красной осью через «х», шкала засечек, штриховка и
 * девиз. Собирается из контуров того же шрифта, что и конструктор знака,
 * поэтому выглядит одинаково везде и не ждёт загрузки шрифта.
 *
 * Лист квадратный: обложка книжки, а не баннер. Строки подписи и девиза
 * разгоняются по всей ширине набора — если текст поменяют, композиция не
 * разъедется.
 */
import type { GlyphFont } from "./vh2Sign";

export interface CoverParams {
  /** Подпись над знаком: прочтение адреса вслух (Р-56). */
  title: string;
  /** Знак: буквы и степень отдельно — степень поднимается к верху строки. */
  big: string;
  exponent: string;
  motto: string;
  footer: string;
  paper: string;
  ink: string;
  red: string;
}

/** Цвета сняты с пробы: старая бумага, тёплая сажа, кирпичный красный. */
export const COVER_DEFAULTS: CoverParams = {
  title: "ДВА ВХУТЕМАС РУ",
  big: "Вх",
  exponent: "2",
  motto: "ИСКУССТВО = Вх² · м",
  footer: "2vhutemas · курс квантовой архитектуры",
  paper: "#EFE6D3",
  ink: "#2B2621",
  red: "#B8402B",
};

const SHEET = 1000;
const MARGIN = 92;
const MEASURE = SHEET - 2 * MARGIN;

export function buildCover(p: CoverParams, F: GlyphFont): string {
  const adv = (ch: string) => (F.g[ch] ?? F.g["?"])[0];
  const outline = (ch: string) => (F.g[ch] ?? F.g["?"])[1];
  const glyph = (ch: string, x: number, y: number, s: number) =>
    `<path transform="translate(${x.toFixed(1)},${y.toFixed(1)}) scale(${s.toFixed(5)},${(-s).toFixed(5)})" d="${outline(ch)}"/>`;
  const width = (text: string, s: number) =>
    [...text].reduce((w, ch) => w + adv(ch) * s, 0);

  /**
   * Строка на ширину набора. `justify` — разогнать буквы врозь до полей,
   * иначе поставить по центру. Слишком длинную строку ужимаем: поля важнее
   * заданного кегля.
   */
  const line = (text: string, cap: number, baseline: number, justify: boolean) => {
    const chars = [...text];
    let s = cap / F.cap;
    let w = width(text, s);
    if (w > MEASURE) {
      s *= MEASURE / w;
      w = MEASURE;
    }
    const track = justify && chars.length > 1 ? (MEASURE - w) / (chars.length - 1) : 0;
    let x = justify ? MARGIN : MARGIN + (MEASURE - w) / 2;
    const out: string[] = [];
    for (const ch of chars) {
      out.push(glyph(ch, x, baseline, s));
      x += adv(ch) * s + track;
    }
    return out.join("");
  };

  // ── Знак: «Вх» одним кеглем, степень вдвое мельче и вровень с верхом.
  const CAP = 232;
  const S = CAP / F.cap;
  const S2 = S * 0.5;
  const signW = width(p.big, S) + 18 + width(p.exponent, S2);
  let x = MARGIN + (MEASURE - signW) / 2;
  const baseY = 470;
  const sign: string[] = [];
  let axis = x;
  for (const ch of p.big) {
    sign.push(glyph(ch, x, baseY, S));
    // Ось проходит серединой последней буквы знака — это «х».
    axis = x + (adv(ch) * S) / 2;
    x += adv(ch) * S;
  }
  x += 18;
  const supY = baseY - F.cap * S + F.cap * S2;
  for (const ch of p.exponent) {
    sign.push(glyph(ch, x, supY, S2));
    x += adv(ch) * S2;
  }

  // ── Ось: красный луч сквозь лист, чуть тоньше штриха буквы.
  const beam = F.stem * S * 0.72;

  // ── Шкала: засечки поперёк оси и штриховка справа от неё, как деления.
  const gridY = 524, step = 58, hatchX = axis + beam / 2 + 16, hatchW = 60;
  const ticks: string[] = [];
  for (let i = 0; i < 3; i++) {
    const y = gridY + i * step;
    ticks.push(`<line x1="${(axis - 212).toFixed(1)}" y1="${y}" x2="${(hatchX + hatchW).toFixed(1)}" y2="${y}"/>`);
  }

  /** Штриховка под 45°, обрезанная прямоугольником. */
  let clipId = 0;
  const hatch = (y0: number, y1: number) => {
    const id = `vh2-h${clipId++}`;
    const lines: string[] = [];
    for (let d = -(y1 - y0); d < hatchW; d += 9) {
      lines.push(`<line x1="${(hatchX + d).toFixed(1)}" y1="${y1}" x2="${(hatchX + d + (y1 - y0)).toFixed(1)}" y2="${y0}"/>`);
    }
    return `<g clip-path="url(#${id})"><clipPath id="${id}"><rect x="${hatchX.toFixed(1)}" y="${y0}" width="${hatchW}" height="${y1 - y0}"/></clipPath>${lines.join("")}</g>`;
  };
  const blocks = [
    hatch(170, 258),
    hatch(gridY - step, gridY),
    hatch(gridY, gridY + step),
    hatch(gridY + step, gridY + 2 * step),
    hatch(772, 862),
  ];

  const o: string[] = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SHEET} ${SHEET}" width="${SHEET}" height="${SHEET}">`);
  o.push(`<rect width="100%" height="100%" fill="${p.paper}"/>`);
  o.push(`<g stroke="${p.ink}" stroke-width="1.7">${blocks.join("")}</g>`);
  o.push(`<g stroke="${p.ink}" stroke-width="3.4">${ticks.join("")}</g>`);
  // Луч ниже букв: на пересечении с «х» остаётся цвет краски, как в пробе.
  o.push(`<rect x="${(axis - beam / 2).toFixed(1)}" y="58" width="${beam.toFixed(1)}" height="838" fill="${p.red}"/>`);
  o.push(`<g fill="${p.ink}">`);
  o.push(line(p.title, 32, 132, true));
  o.push(sign.join(""));
  o.push(line(p.motto, 62, 748, false));
  o.push(line(p.footer, 26, 918, true));
  o.push(`</g></svg>`);
  return o.join("\n");
}
