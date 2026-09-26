/**
 * Знак проекта «Искусство = Вх² · м» (решение Р-56).
 *
 * Буквы — контуры Oswald Bold, извлечённые из шрифта (OFL 1.1), поэтому
 * знак собирается одинаково в любом браузере и без загрузки шрифта.
 * Красная «х» и луч строятся по углу: луч — продолжение восходящего штриха,
 * а угол берётся из диагоналей самого шрифта, чтобы «х» не резала строку.
 */
import glyphs from "./oswald-bold-glyphs.json";

interface GlyphFont {
  stem: number;
  xh: number;
  cap: number;
  g: Record<string, [number, string]>;
}

const F = glyphs as unknown as GlyphFont;

export interface SignParams {
  leftWord: string;
  rightWord: string;
  bigLetter: string;
  exponent: string;
  showDot: boolean;
  angle: number;
  big: number;
  xh: number;
  stroke: number;
  sup: number;
  supBold: number;
  beam: "down" | "up" | "none";
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
  leftWord: "Искусство", rightWord: "м", bigLetter: "В", exponent: "2", showDot: true,
  angle: 69, big: 2.7, xh: 1, stroke: 0.92, sup: 0.52, supBold: 0.72, beam: "down",
  fadeL: 0.5, fadeR: 0, dot: 7, hr: 0.8, by: 0.36,
  paper: "#F1EADB", ink: "#1B1A18", red: "#D8312A", transparent: false,
};

/** Углы диагоналей Oswald Bold, измеренные по контурам букв. */
export const ANGLE_PRESETS: [string, number][] = [["к", 69], ["м", 67], ["Х", 70], ["у", 78]];

const glyph = (ch: string) => F.g[ch] ?? F.g["?"];
const adv = (ch: string) => glyph(ch)[0];

interface Placed { ch: string; x: number; y: number; sc: number; cls: "small" | "big" | "sup" }

export function buildSign(p: SignParams): string {
  const CAP = F.cap, XH = F.xh, stem = F.stem;
  const s = 0.13, S = s * p.big, S2 = S * p.sup;
  const th = (p.angle * Math.PI) / 180;
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
  const run = h / Math.tan(th);
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

  // Красная «х»: два штриха по осевым линиям, восходящий может продолжаться лучом.
  const c0 = xX0 + thh / 2;
  const topX = c0 + run;
  let rise: number[][];
  if (p.beam === "down") {
    const drop = H - baseY, ex = c0 - drop / Math.tan(th);
    rise = [[ex - thh / 2, drop], [ex + thh / 2, drop], [topX + thh / 2, -h], [topX - thh / 2, -h]];
  } else if (p.beam === "up") {
    const up = baseY, ex = c0 + up / Math.tan(th);
    rise = [[c0 - thh / 2, 0], [c0 + thh / 2, 0], [ex + thh / 2, -up], [ex - thh / 2, -up]];
  } else {
    rise = [[c0 - thh / 2, 0], [c0 + thh / 2, 0], [topX + thh / 2, -h], [topX - thh / 2, -h]];
  }
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

  // Затухание — полутоновый растр под 45°, точки мельчают к краю.
  const d = p.dot, dots: string[] = [];
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
        const r = d * 0.72 * Math.pow(outerLeft ? t : 1 - t, 0.8);
        if (r > 0.35) dots.push(`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${r.toFixed(2)}"/>`);
      }
    }
  };
  if (p.fadeL > 0) zone(Lf0, Lf1, true);
  if (p.fadeR > 0) zone(Rf0, Rf1, false);
  if (dots.length) o.push(`<g fill="${p.ink}" clip-path="url(#vh2-txt)">${dots.join("")}</g>`);

  // Степень меньше «В», поэтому тоньше; обводка возвращает ей насыщенность строки.
  const supStroke = Math.max(stem * S * p.supBold - stem * S2, 0);
  for (const it of other) {
    const path = gp(it);
    o.push(it.cls === "sup"
      ? path.replace("<path", `<path fill="${p.ink}" stroke="${p.ink}" stroke-width="${(supStroke / it.sc).toFixed(1)}" stroke-linejoin="miter"`)
      : path.replace("<path", `<path fill="${p.ink}"`));
  }
  o.push(`<g fill="${p.red}"><polygon points="${poly(rise)}"/><polygon points="${poly(fall)}"/></g>`);
  o.push(`</svg>`);
  return o.join("\n");
}
