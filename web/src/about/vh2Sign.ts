/**
 * Знак проекта «Искусство = Вх² · м» (решение Р-56).
 *
 * Буквы — контуры шрифтов с открытой лицензией (OFL 1.1), извлечённые
 * заранее, поэтому знак собирается одинаково в любом браузере и без
 * загрузки шрифта. Красная «х» и луч строятся по углу: луч — продолжение
 * восходящего штриха. При 90° «х» схлопывается в вертикальную ось.
 * Углы-подсказки измерены по диагоналям самого шрифта.
 */

export interface GlyphFont {
  upm: number;
  stem: number;
  xh: number;
  cap: number;
  presets: [string, number][];
  g: Record<string, [number, string]>;
}

export type FontKey = "oswald" | "montserrat" | "unbounded";

export const FONTS: { key: FontKey; name: string; note: string; load: () => Promise<GlyphFont> }[] = [
  { key: "oswald", name: "Oswald", note: "узкий, Bold", load: () => import("./fonts/oswald.json").then((m) => m.default as unknown as GlyphFont) },
  { key: "montserrat", name: "Montserrat", note: "широкий геометрический, ExtraBold", load: () => import("./fonts/montserrat.json").then((m) => m.default as unknown as GlyphFont) },
  { key: "unbounded", name: "Unbounded", note: "очень широкий, ExtraBold", load: () => import("./fonts/unbounded.json").then((m) => m.default as unknown as GlyphFont) },
];

export interface SignParams {
  font: FontKey;
  leftWord: string;
  rightWord: string;
  bigLetter: string;
  exponent: string;
  showDot: boolean;
  angle: number;
  xRed: boolean;
  big: number;
  xh: number;
  stroke: number;
  sup: number;
  supBold: number;
  beam: "down" | "up" | "both" | "none";
  ticks: number;
  tickLen: number;
  tickGap: number;
  fadeStyle: "dots" | "hatch";
  fadeL: number;
  fadeR: number;
  dot: number;
  hr: number;
  by: number;
  paper: string;
  ink: string;
  red: string;
  transparent: boolean;
}

export const SIGN_DEFAULTS: SignParams = {
  font: "oswald", leftWord: "Искусство", rightWord: "м", bigLetter: "В", exponent: "2", showDot: true,
  angle: 69, xRed: true, big: 2.7, xh: 1, stroke: 0.92, sup: 0.52, supBold: 0.72, beam: "down",
  ticks: 0, tickLen: 0.22, tickGap: 1,
  fadeStyle: "dots", fadeL: 0.5, fadeR: 0, dot: 7, hr: 0.8, by: 0.36,
  paper: "#F1EADB", ink: "#1B1A18", red: "#D8312A", transparent: false,
};

export const PALETTES: { name: string; paper: string; ink: string; red: string }[] = [
  { name: "Экран", paper: "#F1EADB", ink: "#1B1A18", red: "#D8312A" },
  // Сняты с пробы Midjourney: кирпичный красный, тёплая сажа, старая бумага.
  { name: "Печать 1920-х", paper: "#DDCBA9", ink: "#3B352F", red: "#AB402F" },
];

/** Набор «как в пробе»: вертикальная ось, засечки, штриховка, печатная палитра. */
export const AXIS_LOOK: Partial<SignParams> = {
  font: "montserrat", angle: 90, xRed: true, beam: "both", ticks: 3, tickLen: 0.2, tickGap: 1.3,
  fadeStyle: "hatch", fadeL: 0.5, dot: 8, big: 2.4, ...PALETTES[1],
};

interface Placed { ch: string; x: number; y: number; sc: number; cls: "small" | "big" | "sup" }

export function buildSign(p: SignParams, F: GlyphFont): string {
  const glyph = (ch: string) => F.g[ch] ?? F.g["?"];
  const adv = (ch: string) => glyph(ch)[0];
  const CAP = F.cap, XH = F.xh, stem = F.stem;
  // Строка одного роста в любом шрифте: масштаб от высоты заглавной.
  const s = (0.13 * 810) / CAP, S = s * p.big, S2 = S * p.sup;
  const th = (Math.min(Math.max(p.angle, 30), 90) * Math.PI) / 180;
  const cot = Math.abs(Math.cos(th)) < 1e-9 ? 0 : Math.cos(th) / Math.sin(th);
  const margin = 140;
  const items: Placed[] = [];
  let x = 0;
  const put = (ch: string, sc: number, y: number, cls: Placed["cls"]) => {
    items.push({ ch, x, y, sc, cls });
    x += adv(ch) * sc;
  };
  const sp = adv(" ") * s;

  for (const ch of p.leftWord) put(ch, s, 0, "small");
  const leftEnd = x;
  if (p.leftWord) x += sp * 0.8;
  put("=", s, 0, "small");
  x += sp * 0.8;
  for (const ch of p.bigLetter) put(ch, S, 0, "big");
  x += 18;
  const h = XH * S * p.xh;
  const thh = (stem * S * 0.92 * p.stroke) / Math.sin(th); // толщина штриха по горизонтали
  const run = h * cot;
  const xX0 = x;
  x += run + thh + 10;
  const supY = -(CAP * S) + CAP * S2;
  for (const ch of p.exponent) put(ch, S2, supY, "sup");
  x += sp * 0.9;
  let dotX: number | null = null;
  if (p.showDot) {
    dotX = x + stem * s * 0.9;
    x += stem * s * 1.8 + sp * 0.9;
  }
  const rightStart = x;
  for (const ch of p.rightWord) put(ch, s, 0, "small");
  const total = x;

  const W = total + 2 * margin, H = Math.round(W * p.hr), ox = margin, baseY = H * p.by;
  const pt = (a: number, b: number) => `${(a + ox).toFixed(1)},${(b + baseY).toFixed(1)}`;
  const poly = (pts: number[][]) => pts.map((q) => pt(q[0], q[1])).join(" ");

  // «х»: два штриха по осевым линиям; восходящий может продолжаться лучом.
  // Ось восходящего штриха: x = c0 − y·ctg(угла), y отсчитан вниз от строки.
  const c0 = xX0 + thh / 2;
  const axisX = (y: number) => c0 - y * cot;
  const beamFrom = p.beam === "up" ? -baseY : p.beam === "both" ? -CAP * S * 1.12 : -h;
  const beamTo = p.beam === "down" || p.beam === "both" ? H - baseY : 0;
  const rise = [
    [axisX(beamTo) - thh / 2, beamTo], [axisX(beamTo) + thh / 2, beamTo],
    [axisX(beamFrom) + thh / 2, beamFrom], [axisX(beamFrom) - thh / 2, beamFrom],
  ];
  const fall = [[c0 - thh / 2, -h], [c0 + thh / 2, -h], [c0 + run + thh / 2, 0], [c0 + run - thh / 2, 0]];

  const gp = (it: Placed) =>
    `<path transform="translate(${(it.x + ox).toFixed(1)},${(it.y + baseY).toFixed(1)}) scale(${it.sc.toFixed(4)},${(-it.sc).toFixed(4)})" d="${glyph(it.ch)[1]}"/>`;
  const small = items.filter((i) => i.cls === "small");
  const other = items.filter((i) => i.cls !== "small");
  const top = baseY - CAP * s - 40, bot = baseY + 60;
  const Lf0 = ox, Lf1 = ox + leftEnd * p.fadeL;
  const Rf0 = ox + total - (total - rightStart) * p.fadeR, Rf1 = ox + total;
  const dotCirc = dotX === null
    ? ""
    : `<circle cx="${(dotX + ox).toFixed(1)}" cy="${(baseY - (XH * s) / 2).toFixed(1)}" r="${(stem * s * 0.62).toFixed(1)}"/>`;

  const o: string[] = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W.toFixed(0)} ${H}" width="${W.toFixed(0)}" height="${H}">`);
  if (!p.transparent) o.push(`<rect width="100%" height="100%" fill="${p.paper}"/>`);
  o.push(`<defs><clipPath id="vh2-txt">${small.map(gp).join("")}${dotCirc}</clipPath>`);
  o.push(`<clipPath id="vh2-solid"><rect x="${Lf1.toFixed(1)}" y="${top.toFixed(1)}" width="${Math.max(Rf0 - Lf1, 0).toFixed(1)}" height="${(bot - top).toFixed(1)}"/></clipPath></defs>`);
  o.push(`<g clip-path="url(#vh2-solid)"><rect x="0" y="${top.toFixed(1)}" width="${W.toFixed(0)}" height="${(bot - top).toFixed(1)}" fill="${p.ink}" clip-path="url(#vh2-txt)"/></g>`);

  // Затухание под 45°: полутоновая точка или штриховка, мельчающая к краю.
  const d = p.dot, marks: string[] = [];
  const k45 = Math.SQRT1_2;
  const zone = (a: number, b: number, outerLeft: boolean) => {
    if (b - a < 1) return;
    const cx = (a + b) / 2, cy = baseY - (CAP * s) / 2;
    const R = Math.ceil(Math.hypot(b - a, bot - top) / d) + 2;
    for (let i = -R; i <= R; i++) {
      for (let j = -R; j <= R; j++) {
        const px = (i - j) * k45 * d + cx, py = (i + j) * k45 * d + cy;
        if (px < a - 4 || px > b + 4 || py < top || py > bot) continue;
        const t = Math.min(Math.max((px - a) / (b - a), 0), 1);
        const k = Math.pow(outerLeft ? t : 1 - t, 0.8);
        if (p.fadeStyle === "hatch") {
          const w = d * 0.95 * k;
          if (w > 0.35) {
            marks.push(`<line x1="${px.toFixed(1)}" y1="${py.toFixed(1)}" x2="${(px - d * k45).toFixed(1)}" y2="${(py + d * k45).toFixed(1)}" stroke-width="${w.toFixed(2)}"/>`);
          }
        } else {
          const r = d * 0.72 * k;
          if (r > 0.35) marks.push(`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${r.toFixed(2)}"/>`);
        }
      }
    }
  };
  if (p.fadeL > 0) zone(Lf0, Lf1, true);
  if (p.fadeR > 0) zone(Rf0, Rf1, false);
  if (marks.length) {
    o.push(p.fadeStyle === "hatch"
      ? `<g stroke="${p.ink}" stroke-linecap="square" clip-path="url(#vh2-txt)">${marks.join("")}</g>`
      : `<g fill="${p.ink}" clip-path="url(#vh2-txt)">${marks.join("")}</g>`);
  }

  // Засечки: тонкие горизонтали поперёк луча, как деления шкалы.
  if (p.beam !== "none" && p.ticks > 0) {
    const hair = Math.max(stem * s * 0.07, 1.2);
    const len = W * p.tickLen;
    const step = CAP * s * 1.6 * p.tickGap;
    const lines: string[] = [];
    for (let n = 1; n <= p.ticks; n++) {
      const y = p.beam === "up" ? -h - n * step : n * step;
      if (y > H - baseY - 10 || y < -baseY + 10) break;
      const cx = axisX(y);
      lines.push(`<line x1="${(cx - len / 2 + ox).toFixed(1)}" y1="${(y + baseY).toFixed(1)}" x2="${(cx + len / 2 + ox).toFixed(1)}" y2="${(y + baseY).toFixed(1)}"/>`);
    }
    o.push(`<g stroke="${p.ink}" stroke-width="${hair.toFixed(2)}">${lines.join("")}</g>`);
  }

  // Степень меньше «В», поэтому тоньше; обводка возвращает ей насыщенность строки.
  const supStroke = Math.max(stem * S * p.supBold - stem * S2, 0);
  for (const it of other) {
    const path = gp(it);
    o.push(it.cls === "sup"
      ? path.replace("<path", `<path fill="${p.ink}" stroke="${p.ink}" stroke-width="${(supStroke / it.sc).toFixed(1)}" stroke-linejoin="miter"`)
      : path.replace("<path", `<path fill="${p.ink}"`));
  }
  // Луч всегда красный; сама «х» — красная или в цвет строки.
  const beamPoly = `<polygon fill="${p.red}" points="${poly(rise)}"/>`;
  const xFill = p.xRed ? p.red : p.ink;
  if (p.beam === "none") {
    o.push(`<g fill="${xFill}"><polygon points="${poly(rise)}"/><polygon points="${poly(fall)}"/></g>`);
  } else if (p.xRed) {
    o.push(`<g fill="${p.red}"><polygon points="${poly(rise)}"/><polygon points="${poly(fall)}"/></g>`);
  } else {
    // Чёрная «х»: луч красный, а в пределах буквы штрихи в цвет строки.
    const letterRise = [[c0 - thh / 2, 0], [c0 + thh / 2, 0], [c0 + run + thh / 2, -h], [c0 + run - thh / 2, -h]];
    o.push(beamPoly);
    o.push(`<g fill="${p.ink}"><polygon points="${poly(letterRise)}"/><polygon points="${poly(fall)}"/></g>`);
  }
  o.push(`</svg>`);
  return o.join("\n");
}
