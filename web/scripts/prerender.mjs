// Готовый HTML текстов «О проекте» (Р-65): последний шаг `npm run build`.
//
// Перед ним Vite собирает src/about/prerender.tsx для Node в dist-ssr/.
// Здесь фрагменты рендерятся и кладутся в dist/prerender/about.json, откуда
// их берёт API. Пустой фрагмент — ошибка сборки: иначе поисковик молча
// получил бы раздел без текста, как было до этого шага.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundle = join(root, "dist-ssr", "prerender.js");
const { render } = await import(pathToFileURL(bundle).href);

const sections = render();
for (const [key, html] of Object.entries(sections)) {
  if (!html || html.length < 200) {
    console.error(`prerender: раздел «${key}» пуст (${html?.length ?? 0} знаков)`);
    process.exit(1);
  }
}

mkdirSync(join(root, "dist", "prerender"), { recursive: true });
writeFileSync(join(root, "dist", "prerender", "about.json"), JSON.stringify(sections));
rmSync(join(root, "dist-ssr"), { recursive: true, force: true });
console.log(
  "prerender: " +
    Object.entries(sections).map(([key, html]) => `${key} ${html.length}`).join(", "),
);
