/**
 * Лист знаков «Вх² Чертёжный алфавит» — предпросмотр всех 101 знака.
 *
 * Служебный модуль: готовит один лист для вычитки знаков (сетка, подложка
 * чипа, размеры 14 и 16 px). Разметка правится в браузере, в карточку знаки
 * попадают из `conceptIcons.ts`.
 */
import { CONCEPT_ICON_KEYS, conceptIconSvg } from "./conceptIcons.ts";

/** Оси классификации — для группировки на листе. */
const AXIS_TITLES: Record<string, string> = {
  epoch: "Ось 1. Эпохи и парадигмы",
  style: "Ось 2. Направления и школы",
  method: "Ось 3. Методы формообразования",
  trait: "Ось 4. Морфологические признаки",
};

/** Русские названия понятий по ключам знаков — из реестра. */
const CONCEPT_TITLES: Record<string, string> = {
  epoch_tradition: "Традиционная архитектура и историзм",
  epoch_fin_de_siecle: "Рубеж XIX–XX веков (эпоха модерна)",
  epoch_avant_garde: "Эпоха авангарда",
  epoch_modernism: "Модернизм",
  epoch_postmodernism: "Постмодернизм",
  epoch_metamodernism: "Метамодернизм",
  style_historicism: "Историзм и эклектика",
  style_neogothic: "Неоготика",
  style_neorussian: "Неорусский стиль",
  style_arts_crafts: "Движение искусств и ремёсел",
  style_art_nouveau: "Модерн",
  style_secession: "Венский сецессион",
  style_northern_nouveau: "Северный модерн",
  style_rus_avantgarde: "Русский / советский авангард",
  style_constructivism: "Конструктивизм",
  style_asnova: "Рационализм АСНОВА",
  style_suprematism: "Супрематизм",
  style_futurism: "Футуризм",
  style_expressionism: "Экспрессионизм",
  style_czech_cubism: "Чешский кубизм",
  style_de_stijl: "Де Стейл",
  style_chicago: "Чикагская школа",
  style_bauhaus: "Баухаус",
  style_functionalism: "Функционализм",
  style_international: "Интернациональный стиль",
  style_euro_rationalism: "Европейский рационализм",
  style_soviet_modernism: "Советский модернизм",
  style_minimalism: "Архитектурный минимализм",
  style_art_deco: "Ар-деко",
  style_streamline: "Стримлайн-модерн",
  style_monumental_neo: "Монументальный неоклассицизм",
  style_postconstructivism: "Постконструктивизм",
  style_soviet_artdeco: "Советское ар-деко",
  style_stalinist_empire: "Сталинский ампир",
  style_national_socreal: "Национально-республиканский соцреализм",
  style_brutalism: "Брутализм",
  style_organic: "Органическая архитектура",
  style_critical_regionalism: "Критический регионализм",
  style_midcentury: "Мидсенчури-модерн",
  style_structuralism: "Структурализм",
  style_hightech: "Хай-тек",
  style_struct_expr: "Структурный экспрессионизм",
  style_metabolism: "Метаболизм",
  style_googie: "Гуги",
  style_postmodern: "Постмодернизм в архитектуре",
  style_deconstructivism: "Деконструктивизм",
  style_pragmatic_icon: "Прагматическая утопия",
  style_blobitecture: "Блобизм",
  style_biomorphic: "Биоморфная архитектура",
  style_computational: "Цифровая архитектура",
  style_parametricism: "Параметрицизм",
  method_tectonic: "Тектонический метод",
  method_geometric: "Геометрико-пропорциональный метод",
  method_modular: "Модульно-комбинаторный метод",
  method_functional: "Функционально-пространственный метод",
  method_environmental: "Средовой метод",
  method_typological: "Типологический метод",
  method_plastic: "Пластический метод",
  method_symbolic: "Знаково-символический метод",
  method_perceptual: "Перцептивный метод",
  method_algorithmic: "Алгоритмический метод",
  trait_suspended_floors: "Подвесные перекрытия",
  trait_concrete_core: "Несущее ядро",
  trait_pilotis: "Опоры-пилоны",
  trait_cantilever: "Консольный вынос",
  trait_thin_shell: "Тонкостенная оболочка",
  trait_diagrid: "Гиперболоидная решётка",
  trait_exoskeleton: "Открытый каркас",
  trait_membrane: "Мембранная кровля",
  trait_glazed_vault: "Остеклённый свод",
  trait_asymmetric: "Асимметричная композиция",
  trait_tilted_cylinder: "Наклонный цилиндр",
  trait_stepped: "Ступенчатый силуэт",
  trait_intersecting: "Врезание объёмов",
  trait_capsules: "Сменные капсулы",
  trait_roof_ramp: "Кровля-пандус",
  trait_open_stair: "Открытая лестница",
  trait_shards: "Наклонные осколки",
  trait_biomorphic_shell: "Биоморфная оболочка",
  trait_symmetry: "Осевая симметрия",
  trait_spire: "Ярусная башня",
  trait_ribbon_window: "Ленточное остекление",
  trait_corner_glass: "Угловое остекление",
  trait_curtain_wall: "Сплошной стеклянный фасад",
  trait_sawtooth: "Шедовые фонари",
  trait_brise_soleil: "Бриз-солей",
  trait_porthole: "Окна-иллюминаторы",
  trait_exposed_concrete: "Открытый бетон",
  trait_formwork: "Следы опалубки",
  trait_white_plaster: "Гладкая штукатурка",
  trait_rusticated_stone: "Рустованный камень",
  trait_timber_frame: "Деревянный каркас",
  trait_metal_cladding: "Металлическая чешуя",
  trait_brickwork: "Кирпичная кладка",
  trait_supergraphics: "Суперграфика",
  trait_epigraphy: "Эпиграфический фасад",
  trait_classical_order: "Классический ордер",
  trait_soviet_heraldry: "Советская геральдика",
  trait_folk_ornament: "Народный орнамент",
  trait_ironic_quote: "Ироничная цитата",
  trait_mosaic_frieze: "Мозаичный фриз",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Лист со всеми знаками: по осям, в трёх подачах — 16 px на бумаге, 14 px на чипе, 32 px для вычитки. */
export function conceptIconsSheetHtml(): string {
  const groups = ["epoch", "style", "method", "trait"].map((axis) => ({
    axis,
    title: AXIS_TITLES[axis],
    keys: CONCEPT_ICON_KEYS.filter((key) => key.startsWith(`${axis}_`)),
  }));

  const cards = groups.map((group) => `
    <section class="axis">
      <h2>${escapeHtml(group.title)} <small>${group.keys.length}</small></h2>
      <div class="grid">
        ${group.keys.map((key) => {
          const title = CONCEPT_TITLES[key] ?? key;
          return `<figure class="cell">
            <div class="paper">${conceptIconSvg(key, undefined, { size: 16 })}</div>
            <div class="chip">${conceptIconSvg(key, undefined, { size: 14 })}<span>${escapeHtml(title)}</span></div>
            <div class="big">${conceptIconSvg(key, undefined, { size: 32 })}</div>
            <figcaption>${escapeHtml(key)}</figcaption>
          </figure>`;
        }).join("")}
      </div>
    </section>`).join("");

  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<title>Вх² Чертёжный алфавит — 101 знак</title>
<style>
  :root { --bg: #FBF8F2; --ink: #26221D; --chip: #F1ECE3; --line: #D8D0C2; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px; background: var(--bg); color: var(--ink);
         font: 14px/1.4 "Inter", "Segoe UI", system-ui, sans-serif; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .lead { margin: 0 0 24px; color: #6B6154; }
  h2 { font-size: 15px; margin: 28px 0 10px; }
  h2 small { color: #8C8272; font-weight: 400; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(212px, 1fr)); gap: 10px; }
  .cell { margin: 0; padding: 8px; border: 1px solid var(--line); border-radius: 8px; background: #fff; }
  .paper { display: flex; align-items: center; justify-content: center; height: 40px; }
  .chip { display: flex; align-items: center; gap: 6px; margin-top: 6px; padding: 4px 8px;
          background: var(--chip); border-radius: 999px; width: fit-content; max-width: 100%; }
  .chip span { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .big { display: flex; align-items: center; justify-content: center; height: 40px; margin-top: 6px;
         border-top: 1px dashed var(--line); }
  figcaption { margin-top: 4px; font: 11px/1.3 ui-monospace, "Cascadia Mono", monospace; color: #8C8272; }
  .concept-icon { display: block; }
  .paper .concept-icon { color: #26221D; }
  .chip .concept-icon { flex: none; color: #A9381F; }
  .big .concept-icon { color: #2F5D8A; }
</style></head><body>
<h1>Вх² Чертёжный алфавит — 101 знак</h1>
<p class="lead">Слева — 16 px на бумаге (--bg #FBF8F2), по центру — 14 px на подложке чипа, справа — 32 px для вычитки формы.</p>
${cards}
</body></html>`;
}
