/**
 * Готовый HTML текстов «О проекте» для поисковиков (Р-65).
 *
 * Собирается при сборке клиента (`npm run build`, шаг `scripts/prerender.mjs`)
 * из тех же компонентов, что рисует клиент, — второго экземпляра текста нет.
 * API вкладывает эти фрагменты в готовую страницу `/about/{раздел}`.
 * Интерактивная часть (обложка, конструктор знака) сюда не входит: без
 * браузера её нечем нарисовать, и поисковику она ничего не скажет.
 */
import { renderToStaticMarkup } from "react-dom/server";
import {
  BuilderNote, CoverNote, Feedback, FontsCredit, LogoIntro, Manifest, Philosophy,
} from "./texts";

export function render(): Record<string, string> {
  return {
    logo: renderToStaticMarkup(
      <>
        <LogoIntro />
        <h2>Обложка</h2>
        <CoverNote />
        <h2>Конструктор знака</h2>
        <BuilderNote />
        <FontsCredit />
      </>,
    ),
    philosophy: renderToStaticMarkup(<Philosophy />),
    manifest: renderToStaticMarkup(<Manifest />),
    feedback: renderToStaticMarkup(<Feedback />),
  };
}
