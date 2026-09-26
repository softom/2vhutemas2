/**
 * Пересборка знака для вкладки браузера (решение Р-62).
 *
 *   node tools/make_mark.ts
 *
 * Пишет `web/public/favicon.svg` из того же кода, что рисует обложку, —
 * значок не рисуется отдельно и не расходится с ней.
 *
 * Растровые значки (`favicon.ico`, `apple-touch-icon.png`) сделаны из этого
 * же файла браузером: он единственный здесь умеет растрировать SVG. Как:
 * открыть favicon.svg в браузере, в консоли нарисовать его в canvas нужного
 * размера (16, 32, 48, 180) и сохранить PNG; ICO — это заголовок из шести
 * байт, по шестнадцать байт на размер и сами PNG внутри. Пока знак не
 * меняется, пересобирать их не нужно.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { buildMark, COVER_DEFAULTS } from "../web/src/about/vh2Cover.ts";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const font = JSON.parse(readFileSync(`${root}web/src/about/fonts/montserrat.json`, "utf8"));
const out = `${root}web/public/favicon.svg`;
writeFileSync(out, buildMark(COVER_DEFAULTS, font));
console.log("записан", out);
