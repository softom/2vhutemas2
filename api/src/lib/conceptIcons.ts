/**
 * Знаки понятий «Вх² Чертёжный алфавит» (серверный модуль).
 *
 * Здесь только знаки: модуль общий, его может использовать любой виджет,
 * которому нужна пиктограмма понятия. Разметка и сценарии — в виджете.
 *
 * Правила набора (паспорт «Классификация — цвета и пиктограммы»):
 *  - сетка `viewBox="0 0 16 16"`, рабочее поле 1.5 … 14.5;
 *  - линия `fill="none"`, `stroke="currentColor"`, `stroke-width="1.4"`,
 *    круглые концы и соединения;
 *  - вспомогательный штрих, оси и пунктир — `stroke-width="1"` или
 *    `stroke-dasharray="2 2"`;
 *  - заливка — только смысловой акцент (масса, ядро, супрематический квадрат):
 *    `fill="currentColor"` с `fill-opacity`;
 *  - цвет у знака один: `currentColor`. Красить знак — через `color` у
 *    родителя, поэтому пиктограмма остаётся читаемой и на бумаге, и на
 *    подложке чипа, и печатается без JavaScript.
 *
 * Знак вставляется в готовую серверную разметку инлайном: гость без
 * JavaScript его видит. Клиентского набора знаков нет.
 */

/** Поля, в которых рисуется знак. */
export const CONCEPT_ICON_VIEW_BOX = "0 0 16 16";
/** Размер знака по умолчанию, px. */
export const CONCEPT_ICON_SIZE = 16;

/** Оси классификации: у каждой есть свой запасной знак. */
export type ConceptAxis = "art_epochs" | "art_styles" | "form_method" | "morphological_trait";

/** Класс знака в разметке — чтобы оформление жило в общем файле стилей. */
export const CONCEPT_ICON_CLASS = "concept-icon";

/**
 * Внутренняя разметка знаков: ключ → содержимое `<svg>`.
 * Порядок соответствует реестру: ось 1 (эпохи), ось 2 (направления),
 * ось 3 (методы), ось 4 (морфологические признаки).
 */
const ICON_PATHS: Record<string, string> = {
  // Ось 1. Эпохи и парадигмы — «температура времени».
  epoch_tradition:
    '<path d="M2.5 12.5v-4.2a5.5 5.5 0 0 1 11 0v4.2"/><path d="M4.6 12.5V8.8"/><path d="M11.4 12.5V8.8"/>' +
    '<path d="M6.6 8.2h2.8l-.6 2.1H7.2z" fill="currentColor" fill-opacity="0.35" stroke="none"/>',
  epoch_fin_de_siecle:
    '<rect x="2.5" y="2.5" width="11" height="11" stroke-width="1"/>' +
    '<path d="M2.5 10.6C4.8 4.4 6.8 4.8 8 8.4s3.4 5.2 5.5-.2" stroke-width="1.7"/>',
  epoch_avant_garde:
    '<circle cx="8" cy="9.2" r="4.4"/><path d="M12.8 2.6 9.4 7.4" stroke-width="1.8"/>' +
    '<path d="M13.4 2.2 9.2 7.6l4.4.4z" fill="currentColor" fill-opacity="0.85" stroke="none"/>',
  epoch_modernism:
    '<rect x="3" y="3.8" width="10" height="5.2" fill="currentColor" fill-opacity="0.16" stroke="none"/>' +
    '<rect x="3" y="3.8" width="10" height="5.2"/><path d="M5 9v4.6"/><path d="M11 9v4.6"/>',
  epoch_postmodernism:
    '<path d="M2.5 12.5 7.4 3.2"/><path d="M9.4 5.4 13.5 12.5"/><path d="M4.4 12.5h3.6"/>' +
    '<path d="M9 12.5h4.5"/>',
  epoch_metamodernism:
    '<path d="M8 2.4v1.4"/><circle cx="8" cy="3.4" r="0.9" fill="currentColor" fill-opacity="0.4" stroke="none"/>' +
    '<path d="M8 3.4 10.4 9.2"/><circle cx="10.6" cy="10.1" r="1.6" fill="currentColor" fill-opacity="0.4" stroke="none"/>' +
    '<path d="M3.6 12.8a5.8 5.8 0 0 0 8.8 0"/>',

  // Ось 2. Направления и школы — семь генеалогических семейств.
  style_historicism:
    '<path d="M2.5 12.5V9.6a3.2 3.2 0 0 1 6.4 0v2.9"/><path d="M9.4 12.5 12 8.4l2.6 4.1"/><path d="M9.8 12.5h4.4"/>',
  style_neogothic:
    '<path d="M3 12.6V8.2a5 5 0 0 1 10 0v4.4"/><path d="M8 12.6V6.4"/><path d="M6.2 12.6h3.6"/>',
  style_neorussian:
    '<path d="M2.5 12.5h11"/><path d="M8 2.6c2.7 1.7 4.3 4.1 4.7 7.3"/><path d="M8 2.6C5.3 4.3 3.7 6.7 3.3 9.9"/>' +
    '<path d="M7.2 2.6h1.6"/>',
  style_arts_crafts:
    '<path d="M8 2.5 13.5 8 8 13.5 2.5 8z"/>' +
    '<path d="M8 10.6c1.7-1.1 2.1-2.8 0-4.8-2.1 2-1.7 3.7 0 4.8z" fill="currentColor" fill-opacity="0.32" stroke="none"/>',
  style_art_nouveau:
    '<path d="M8 13.4V9.6c0-2.2 1.8-3.4 4-3.6"/><path d="M8 9.6C8 7.2 6.6 5.6 4.2 5.2"/>' +
    '<path d="M12 6c1.2-.6 1.9-1.7 1.5-2.8-.4-1.1-1.8-1.4-2.7-.6"/>',
  style_secession:
    '<rect x="2.5" y="2.5" width="11" height="11"/><circle cx="8" cy="8" r="3.6"/>' +
    '<circle cx="8" cy="8" r="1.1" fill="currentColor" fill-opacity="0.4" stroke="none"/>',
  style_northern_nouveau:
    '<path d="M2.5 12.5 8 3.2l5.5 9.3"/><path d="M2.5 12.5h11"/><path d="M5 12.5v1.8"/><path d="M11 12.5v1.8"/>' +
    '<path d="M6.2 12.5 8 9.4l1.8 3.1" stroke-width="1"/>',
  style_rus_avantgarde:
    '<path d="M5.6 2.6v10.8"/><path d="M10.4 2.6v10.8"/><path d="M5.6 2.6 10.4 8l-4.8 5.4"/>' +
    '<path d="M5.6 13.4 10.4 8" stroke-width="1"/>',
  style_constructivism:
    '<rect x="2.5" y="3.5" width="11" height="9"/><path d="M2.5 12.5 13.5 3.5" stroke-width="1.9"/>',
  style_asnova:
    '<path d="M2.5 3.4h11"/><path d="M5.2 3.4 6.7 9.4 8.2 3.4"/><path d="M8 3.4 9.5 9.4 11 3.4"/>' +
    '<path d="M6.7 9.4h2.8" stroke-width="1"/>',
  style_suprematism:
    '<rect x="3" y="6.4" width="6.6" height="6.6" fill="currentColor" fill-opacity="0.8" stroke="none"/>' +
    '<path d="M11.6 2.4v8.2"/><path d="M10 2.4h3.2"/>',
  style_futurism:
    '<path d="M2.5 12.6 13.5 3.6"/><path d="M2.5 8.6 13.5 2.6"/><path d="M6.4 13.6 13.5 6.4"/>' +
    '<circle cx="4.2" cy="5.4" r="1.2" fill="currentColor" fill-opacity="0.4" stroke="none"/>',
  style_expressionism:
    '<path d="M8 2.4c1.7 2.3 1.3 3.8 0 5.4 2.5-.4 3.6 1.5 2.7 3.4 2.3.7 2.5 2.7.6 4.3H4.7c-1.9-1.6-1.7-3.6.6-4.3-.9-1.9.2-3.8 2.7-3.4-1.3-1.6-1.7-3.1 0-5.4z" fill="currentColor" fill-opacity="0.24" stroke="none"/>' +
    '<path d="M8 2.4c1.7 2.3 1.3 3.8 0 5.4 2.5-.4 3.6 1.5 2.7 3.4 2.3.7 2.5 2.7.6 4.3H4.7c-1.9-1.6-1.7-3.6.6-4.3-.9-1.9.2-3.8 2.7-3.4-1.3-1.6-1.7-3.1 0-5.4z"/>',
  style_czech_cubism:
    '<path d="M2.5 12.6 7 3.4l3 5 3.5-3.1v7.3z"/><path d="M7 3.4 10 8.4 6.8 12.6"/><path d="M10 8.4 13.5 5.3"/>',
  style_de_stijl:
    '<rect x="2.5" y="2.5" width="11" height="11"/><path d="M2.5 8.2h5.4V2.5"/><path d="M7.9 8.2h5.6"/>' +
    '<rect x="2.5" y="8.2" width="5.4" height="5.3" fill="currentColor" fill-opacity="0.35" stroke="none"/>',
  style_chicago:
    '<path d="M2 4.4h12"/><path d="M4.4 6.6v6.8"/><path d="M8 6.6v6.8"/><path d="M11.6 6.6v6.8"/>' +
    '<path d="M2.4 9.4h11.2"/><path d="M3.2 4.4v-1.7"/><path d="M12.8 4.4v-1.7"/>',
  style_bauhaus:
    '<circle cx="3.9" cy="10" r="2.4"/><path d="M6.9 12.4 8.2 7.2 9.5 12.4z"/>' +
    '<rect x="10.6" y="9.6" width="2.8" height="2.8"/>',
  style_functionalism:
    '<rect x="2.4" y="8.6" width="4.2" height="4.4"/><rect x="9.4" y="3.2" width="4.2" height="4.4"/>' +
    '<path d="M6.6 10.4 9.4 5.8"/>',
  style_international:
    '<path d="M2.5 6.4 8 3.4l5.5 3v7.2L8 13.6l-5.5-3z"/><path d="M2.5 6.4 8 9.4l5.5-3"/><path d="M8 9.4v4.2"/>' +
    '<path d="M2.5 7.9h11" stroke-width="1.8"/>',
  style_euro_rationalism:
    '<path d="M3.4 3.4h3.2v3.2H3.4z"/><path d="M9.4 3.4h3.2v3.2H9.4z"/><path d="M3.4 9.4h3.2v3.2H3.4z"/>' +
    '<path d="M9.4 9.4h3.2v3.2H9.4z"/>',
  style_soviet_modernism:
    '<rect x="1.8" y="5.4" width="12.4" height="2.4" fill="currentColor" fill-opacity="0.22" stroke="none"/>' +
    '<path d="M1.8 5.4h12.4v2.4"/><path d="M10.4 7.8v5"/><path d="M5 7.8v5"/>',
  style_minimalism:
    '<path d="M2.5 5.4h11"/><path d="M2.5 10.6h11"/><path d="M8 5.4v5.2" stroke-width="1" stroke-dasharray="2 2"/>',
  style_art_deco:
    '<path d="M3.6 12.6h8.8"/><path d="M5.4 12.6V9.8h5.2v2.8"/><path d="M6.8 9.8V6.9h2.4v2.9"/>' +
    '<path d="M8 6.9 3.4 3.6"/><path d="M8 6.9 12.6 3.6"/>',
  style_streamline:
    '<path d="M13.5 3.4H8.4A4.6 4.6 0 0 0 3.8 8v4.6"/><path d="M2.5 12.6h11"/><path d="M6.2 9.4h7.3"/>' +
    '<path d="M7.6 6.3h5.9" stroke-width="1"/>',
  style_monumental_neo:
    '<path d="M2.5 4.4h11"/><path d="M4.2 4.4v8.2"/><path d="M8 4.4v8.2"/><path d="M11.8 4.4v8.2"/>' +
    '<path d="M2.5 12.6h11"/>',
  style_postconstructivism:
    '<rect x="2.5" y="3.4" width="11" height="9.2"/><path d="M5.6 12.6V6.6"/><path d="M8 12.6V6.6"/><path d="M10.4 12.6V6.6"/>',
  style_soviet_artdeco:
    '<path d="M2.5 13V8h4V4.4h3V13"/><path d="M9.5 13V8h4"/><path d="M2.5 13h11"/>' +
    '<path d="M11.4 2.2 12.1 4l2 .2-1.4 1.3.3 2-1.8-1-1.8 1 .3-2-1.4-1.3 2-.2z" fill="currentColor" fill-opacity="0.45" stroke="none"/>',
  style_stalinist_empire:
    '<path d="M8 2.4v2.2"/><path d="M6 4.6h4l.6 3H5.4z"/><path d="M5.2 7.6h5.6l.7 3H4.5z"/>' +
    '<path d="M4.9 10.6h6.2v2.4H4.9z"/>',
  style_national_socreal:
    '<path d="M2.5 3.4h11"/><path d="M3.6 13V8.6a4.4 4.4 0 0 1 8.8 0V13"/><path d="M2.5 13h11"/>',
  style_brutalism:
    '<path d="M1.8 4.2h12.4v4.2H1.8z" fill="currentColor" fill-opacity="0.18" stroke="none"/>' +
    '<path d="M1.8 4.2h12.4v4.2"/><path d="M4 8.4v4.4"/><path d="M8 8.4v4.4"/><path d="M12 8.4v4.4"/>',
  style_organic:
    '<path d="M2 13.4h12"/><path d="M3 13.4v-2.6h3.6"/><path d="M6.6 10.8V7.8h3.8"/><path d="M10.4 7.8V4.8h3"/>',
  style_critical_regionalism:
    '<path d="M3.6 4.8h8.8v4.6H3.6z"/><path d="M2.4 9.4h11.2v2.2"/><path d="M4 13.6 6.4 11.6"/><path d="M8 13.6 10.4 11.6"/>',
  style_midcentury:
    '<path d="M2.4 6.4 8 9l5.6-2.6"/><path d="M3.6 8v4.6"/><path d="M8 9v3.6"/><path d="M12.4 8v4.6"/>' +
    '<path d="M2.4 12.6h11.2"/>',
  style_structuralism:
    '<path d="M2.8 3.2h4.4v4.4H2.8z"/><path d="M8.8 3.2h4.4v4.4H8.8z"/><path d="M2.8 8.4h4.4v4.4H2.8z"/>' +
    '<path d="M8.8 8.4h4.4v4.4H8.8z"/><path d="M7.2 5.4h1.6" stroke-width="1"/>',
  style_hightech:
    '<rect x="4" y="4" width="8" height="8"/><path d="M4 4 12 12"/><path d="M2.4 2.4v11.2"/><path d="M13.6 4.6v8.8"/>' +
    '<path d="M2.4 2.4h1.6" stroke-width="1"/>',
  style_struct_expr:
    '<path d="M2.4 12.6h11.2"/><path d="M4.2 12.6 8 3.4l3.8 9.2"/><path d="M8 3.4 2.4 8"/><path d="M8 3.4 13.6 8"/>',
  style_metabolism:
    '<path d="M7 2.4v11.2"/><rect x="8.8" y="3.6" width="4.8" height="2.8" rx="1.4"/>' +
    '<rect x="8.8" y="9.4" width="4.8" height="2.8" rx="1.4"/>',
  style_googie:
    '<path d="M2.4 11.8 8 4.2l5.6 7.6"/><path d="M2.4 11.8h11.2"/><path d="M3.4 8.4a6.4 6.4 0 0 1 9.2-3.2"/>' +
    '<circle cx="12.8" cy="5.2" r="1" fill="currentColor" fill-opacity="0.45" stroke="none"/>',
  style_postmodern:
    '<path d="M2.4 12.6 8 3.4l5.6 9.2"/><circle cx="8" cy="9" r="2"/><path d="M2.4 12.6h11.2"/>',
  style_deconstructivism:
    '<path d="M2.4 4.4h5.4l-1.8 3.6H2.4z"/><path d="M9 6.2 13.6 4v6.4L9 12.2z"/><path d="M2.4 11.2h4.6"/>',
  style_pragmatic_icon:
    '<path d="M4 6.6 8 4.2l4 2.4v4.8L8 11.4 4 9z"/><path d="M4 6.6 8 9l4-2.4"/><path d="M8 9v5.2"/>' +
    '<path d="M4 9v2.2" stroke-width="1"/>',
  style_blobitecture:
    '<path d="M8 2.4c3.4 0 5.8 2.7 5.8 5.6 0 3.2-2.7 5.6-5.8 5.6-3.1 0-5.4-2.1-5.4-4.7 0-2.2 1.4-3.5 3.1-4.6 1.2-.8 1.7-1.9 2.3-1.9z"/>',
  style_biomorphic:
    '<path d="M8 2.4 13 5.2v5.6L8 13.6 3 10.8V5.2z"/><path d="M3 5.2 8 8l5-2.8"/><path d="M8 8v5.6"/>',
  style_computational:
    '<path d="M2.8 12.4 6 4.2l4 2.2 3.2 6"/><path d="M2.8 12.4 10 6.4"/><path d="M6 4.2 13.2 12.4"/>' +
    '<circle cx="2.8" cy="12.4" r="1.1" fill="currentColor" fill-opacity="0.4" stroke="none"/><circle cx="6" cy="4.2" r="1.1" fill="currentColor" fill-opacity="0.4" stroke="none"/>' +
    '<circle cx="10" cy="6.4" r="1.1" fill="currentColor" fill-opacity="0.4" stroke="none"/><circle cx="13.2" cy="12.4" r="1.1" fill="currentColor" fill-opacity="0.4" stroke="none"/>',
  style_parametricism:
    '<path d="M2.4 4.4c3-1.6 5 1.6 8 0"/><path d="M2.4 7c3.2-1.7 4.8 1.7 8.2 0"/>' +
    '<path d="M2.4 9.6c3.4-1.8 4.6 1.8 8.4 0"/><path d="M2.4 12.2c3.6-1.9 4.4 1.9 8.6 0"/>',

  // Ось 3. Методы формообразования — «инструмент архитектора».
  method_tectonic:
    '<path d="M2.6 12.6 8 3.6l5.4 9"/><path d="M8 1.6v2.4"/><path d="M6.9 2.9 8 1.7l1.1 1.2"/>',
  method_geometric:
    '<rect x="2.5" y="4.4" width="11" height="7.2"/><path d="M2.5 11.6 13.5 4.4"/><path d="M2.5 11.6a5 5 0 0 1 5-5"/>',
  method_modular:
    '<path d="M2.5 2.5h11v11h-11z"/><path d="M6.17 2.5v11"/><path d="M9.83 2.5v11"/><path d="M2.5 6.17h11"/><path d="M2.5 9.83h11"/>' +
    '<rect x="6.17" y="6.17" width="3.66" height="3.66" fill="currentColor" fill-opacity="0.3" stroke="none"/>',
  method_functional:
    '<circle cx="4.4" cy="5.4" r="2.5"/><circle cx="11.6" cy="5.4" r="2.5"/><circle cx="8" cy="11.2" r="2.5"/>' +
    '<path d="M6.7 7.3 7.3 9"/><path d="M9.3 7.3 8.7 9"/>',
  method_environmental:
    '<path d="M2.4 12.6c2-1.3 3.6 1.3 5.6 0s3.6 1.3 5.6 0"/><path d="M2.4 9.4c2-1.3 3.6 1.3 5.6 0s3.6 1.3 5.6 0"/>' +
    '<path d="M2.4 6.2c2-1.3 3.6 1.3 5.6 0s3.6 1.3 5.6 0"/><path d="M10.6 2.4h3v3"/><path d="M13.6 2.4 10.8 5.2"/>',
  method_typological:
    '<path d="M2.5 2.5h11v11h-11z"/><path d="M6.2 2.5v11"/><path d="M9.9 2.5v11"/><path d="M2.5 6.2h11"/><path d="M2.5 9.9h11"/>' +
    '<path d="M6.2 2.5 9.9 13.5" stroke-width="1.9"/>',
  method_plastic:
    '<path d="M3.4 13.4c4.8-1.4 1.2-4.6 4.8-5.8 3.6-1.2 0-4.2 4.4-5.2" stroke-width="1.6"/>' +
    '<path d="M5.8 12.6c3.8-1 1-4 4-5" stroke-width="1"/>',
  method_symbolic:
    '<path d="M4 13V8.4h8V13"/><path d="M2.6 5.6h10.8"/><path d="M4 5.6V4"/><path d="M12 5.6V4"/>' +
    '<path d="M6 11.2h4" stroke-width="1"/>',
  method_perceptual:
    '<circle cx="3.4" cy="8" r="1.3" fill="currentColor" fill-opacity="0.4" stroke="none"/><path d="M5 6.9 13 4"/>' +
    '<path d="M5 8h8"/><path d="M5 9.1 13 12"/><path d="M13.2 3.4v9.2"/>',
  method_algorithmic:
    '<path d="M3 12.4c3-9 7-9 10 0"/><circle cx="3" cy="12.4" r="1.2" fill="currentColor" fill-opacity="0.4" stroke="none"/>' +
    '<circle cx="13" cy="12.4" r="1.2" fill="currentColor" fill-opacity="0.4" stroke="none"/><circle cx="8" cy="5.4" r="1.2" fill="currentColor" fill-opacity="0.4" stroke="none"/>' +
    '<path d="M8 5.4 3 12.4"/><path d="M8 5.4 13 12.4"/>',

  // Ось 4. Морфологические признаки — пять физических слоёв здания.
  // Слой 1. Несущая тектоника и перекрытия.
  trait_suspended_floors:
    '<path d="M2 2.8h12"/><path d="M4 2.8v4"/><path d="M8 2.8v4"/><path d="M12 2.8v4"/>' +
    '<path d="M2.4 6.8h11.2"/><path d="M2.4 11h11.2"/>',
  trait_concrete_core:
    '<rect x="6" y="2.4" width="4" height="11.2" fill="currentColor" fill-opacity="0.28" stroke="none"/>' +
    '<path d="M6 2.4h4v11.2H6z"/><path d="M2 6.4h4"/><path d="M10 6.4h4"/><path d="M2 10.2h4"/><path d="M10 10.2h4"/>',
  trait_pilotis:
    '<path d="M2.4 5.4h11.2"/><path d="M4.6 5.4v7.2"/><path d="M8 5.4v7.2"/><path d="M11.4 5.4v7.2"/>' +
    '<path d="M2.4 12.6h11.2"/>',
  trait_cantilever:
    '<path d="M2 4.2h12v2.4H2z" fill="currentColor" fill-opacity="0.18" stroke="none"/><path d="M2 4.2h12v2.4"/>' +
    '<path d="M6 6.6v6"/><path d="M13.4 6.6v1.6" stroke-width="1"/>',
  trait_thin_shell:
    '<path d="M2.5 11.6C5 4 11 4 13.5 11.6"/><path d="M2.5 13.4h11"/><path d="M4.4 12.6C6 7.2 10 7.2 11.6 12.6" stroke-width="1" stroke-dasharray="2 2"/>',
  trait_diagrid:
    '<path d="M2.4 4.4 8 8l5.6-3.6"/><path d="M2.4 11.6 8 8l5.6 3.6"/><path d="M2.4 4.4h11.2" stroke-width="1" stroke-dasharray="2 2"/>',
  trait_exoskeleton:
    '<rect x="4.4" y="2.4" width="7.2" height="11.2" stroke-width="1" stroke-dasharray="2 2"/>' +
    '<path d="M4.4 2.4 11.6 8 4.4 13.6"/><path d="M11.6 2.4 4.4 8 11.6 13.6"/>',
  trait_membrane:
    '<path d="M8 2.4v11.2"/><path d="M8 4C5.2 7 4.2 10 3.4 13.6"/><path d="M8 4c2.8 3 3.8 6 4.6 9.6"/>',
  trait_glazed_vault:
    '<path d="M2.4 12.6a5.6 5.6 0 0 1 11.2 0"/><path d="M2.4 12.6h11.2"/><path d="M8 7v5.6"/>' +
    '<path d="M5.4 8.2 6.6 12.6"/><path d="M10.6 8.2 9.4 12.6"/>',
  // Слой 2. Объёмно-пространственная композиция.
  trait_asymmetric:
    '<path d="M2.4 13V8.2h3V13"/><path d="M6.4 13V3.4h3.2V13"/><path d="M10.6 13V6.8h3V13"/><path d="M2.4 13h11.2"/>',
  trait_tilted_cylinder:
    '<ellipse cx="8" cy="4" rx="2.8" ry="1.3"/><path d="M5.2 4 3.4 12"/><path d="M10.8 4 12.6 12"/>' +
    '<ellipse cx="12.6" cy="12" rx="2.8" ry="1.3"/>',
  trait_stepped:
    '<path d="M4 13v-3h3V7h3V3.4h2V13z"/>',
  trait_intersecting:
    '<rect x="2.4" y="4.4" width="8" height="7.2"/><rect x="5.6" y="6.4" width="8" height="7.2"/>',
  trait_capsules:
    '<path d="M8 2.4v11.2" stroke-width="1"/><rect x="2.4" y="4" width="4.4" height="2.6" rx="1.3"/>' +
    '<rect x="9.2" y="9" width="4.4" height="2.6" rx="1.3"/>',
  trait_roof_ramp:
    '<path d="M2.4 12.4 13.6 6"/><path d="M2.4 13.6h11.2"/><path d="M4.4 12.4v1.2" stroke-width="1"/>',
  trait_open_stair:
    '<path d="M2.6 13v-2.2h2.4V8.6H7.4V6.4h2.4V4.2h3.6"/>',
  trait_shards:
    '<path d="M2.6 12.8 5.6 3.4 7.2 12.8"/><path d="M7.8 12.8 10.4 5.4 12 12.8"/><path d="M12.6 12.8 14.2 7.6"/>',
  trait_biomorphic_shell:
    '<path d="M2.4 12.6c0-4.2 3.2-7.6 6.8-7.6 3 0 4.6 2.4 4.6 5 0 2.4-1.6 4-3.6 4-2 0-3-1.6-3-3.2"/>' +
    '<path d="M2.4 12.6h11.2" stroke-width="1"/>',
  trait_symmetry:
    '<path d="M8 2.4v11.2" stroke-width="1" stroke-dasharray="2 2"/><path d="M2.4 13.6 5.4 5 8 8.6l2.6-3.6 3 8.6"/>',
  trait_spire:
    '<path d="M8 1.4v2.2"/><path d="M6 3.6h4l.6 3H5.4z"/><path d="M5.2 6.6h5.6l.7 3H4.5z"/><path d="M4.4 9.6h7.2l.6 3H3.8z"/>',
  // Слой 3. Свет и остекление.
  trait_ribbon_window:
    '<path d="M2.4 4.4v7.2"/><path d="M13.6 4.4v7.2"/><path d="M2 8h12" stroke-width="1.9"/><path d="M2.4 11.6h11.2" stroke-width="1"/>',
  trait_corner_glass:
    '<path d="M2.4 2.4v11.2"/><path d="M2.4 13.6h11.2"/><path d="M2.4 2.4 13.6 13.6"/>',
  trait_curtain_wall:
    '<rect x="2.4" y="2.4" width="11.2" height="11.2"/><path d="M6.13 2.4v11.2"/><path d="M9.87 2.4v11.2"/>' +
    '<path d="M2.4 6.13h11.2"/><path d="M2.4 9.87h11.2"/>',
  trait_sawtooth:
    '<path d="M2.4 12.6V7.2l3 3 3-6 3 4.8 2.2-2v5.6z"/>',
  trait_brise_soleil:
    '<path d="M2.4 4.4h11.2"/><path d="M2.4 7.4h11.2"/><path d="M2.4 10.4h11.2"/><path d="M4.4 4.4v6"/>' +
    '<path d="M9.4 7.4v6"/>',
  trait_porthole:
    '<path d="M2.4 13.4h11.2"/><circle cx="5" cy="7.6" r="2"/><circle cx="11" cy="7.6" r="2"/>',
  // Слой 4. Материальность и поверхность.
  trait_exposed_concrete:
    '<rect x="2.4" y="4" width="11.2" height="8" fill="currentColor" fill-opacity="0.12" stroke="none"/>' +
    '<circle cx="4.8" cy="6.4" r="0.8"/><circle cx="8" cy="6.4" r="0.8"/><circle cx="11.2" cy="6.4" r="0.8"/>' +
    '<circle cx="4.8" cy="9.6" r="0.8"/><circle cx="8" cy="9.6" r="0.8"/><circle cx="11.2" cy="9.6" r="0.8"/>',
  trait_formwork:
    '<rect x="2.4" y="4.4" width="11.2" height="7.2"/><path d="M2.4 7h11.2"/><path d="M2.4 9.6h11.2"/>',
  trait_white_plaster:
    '<rect x="3.4" y="3.4" width="9.2" height="9.2"/><path d="M5.6 10.4 9.8 5.4" stroke-width="1" stroke-opacity="0.55"/>',
  trait_rusticated_stone:
    '<rect x="2.4" y="4" width="11.2" height="8"/><path d="M2.4 8h11.2"/><path d="M6 4v4"/><path d="M10 8v4"/>' +
    '<path d="M2.4 4 4.6 5.6"/><path d="M2.4 8 4.6 9.6"/>',
  trait_timber_frame:
    '<rect x="2.4" y="2.4" width="11.2" height="11.2"/><path d="M2.4 13.6 7.4 2.4"/><path d="M7.4 13.6 13.6 2.4"/>' +
    '<path d="M7.4 2.4v11.2"/>',
  trait_metal_cladding:
    '<path d="M4 6.4 6 3.9 8 6.4 6 8.9z"/><path d="M8 10.4 10 7.9 12 10.4 10 12.9z"/><path d="M2.4 12.6 4.6 10.4"/>',
  trait_brickwork:
    '<path d="M2.4 5h11.2"/><path d="M2.4 8h11.2"/><path d="M2.4 11h11.2"/><path d="M5.6 5v3"/><path d="M10.4 5v3"/>' +
    '<path d="M8 8v3"/><path d="M3 8v3" stroke-width="1"/>',
  // Слой 5. Знак, ордер и пластика фасада.
  trait_supergraphics:
    '<path d="M2.4 12.8 8 3.2" stroke-width="1.9"/><path d="M6.4 12.8 12 3.2" stroke-width="1.9"/>' +
    '<path d="M2.4 12.8h11.2" stroke-width="1"/>',
  trait_epigraphy:
    '<path d="M3 4.6h10" stroke-width="1"/><path d="M3 7.6h7"/><path d="M3 10.6h10" stroke-width="1"/>' +
    '<path d="M3 12.6h5" stroke-width="1"/>',
  trait_classical_order:
    '<path d="M2.4 4.4h11.2"/><path d="M3.4 7.4h9.2"/><path d="M6 7.4v5.2"/><path d="M8 7.4v5.2"/>' +
    '<path d="M10 7.4v5.2"/><path d="M3.4 12.6h9.2"/>',
  trait_soviet_heraldry:
    '<circle cx="8" cy="8" r="4.8" stroke-width="1" stroke-dasharray="2 2"/>' +
    '<path d="M8 4.6 9 6.9l2.5.3-1.8 1.7.4 2.4L8 10.2 5.9 11.3l.4-2.4L4.5 7.2 7 6.9z" fill="currentColor" fill-opacity="0.5" stroke="none"/>',
  trait_folk_ornament:
    '<path d="M8 2.4 13.6 8 8 13.6 2.4 8z"/><path d="M8 5.6 10.4 8 8 10.4 5.6 8z"/>',
  trait_ironic_quote:
    '<path d="M5.2 11.8c-1.6 0-2.6-1.1-2.6-2.6 0-1.6 1.3-2.7 2.7-2.7-.2-1-1-1.7-2.1-1.9"/>' +
    '<path d="M12.2 11.8c-1.6 0-2.6-1.1-2.6-2.6 0-1.6 1.3-2.7 2.7-2.7-.2-1-1-1.7-2.1-1.9"/>',
  trait_mosaic_frieze:
    '<path d="M2.4 4.4h11.2v7.2H2.4z"/><path d="M5.2 4.4v7.2"/><path d="M8 4.4v7.2"/><path d="M10.8 4.4v7.2"/>' +
    '<path d="M2.4 8h11.2" stroke-width="1"/><rect x="5.2" y="4.4" width="2.8" height="3.6" fill="currentColor" fill-opacity="0.28" stroke="none"/>',

  // Запасные знаки осей: понятие без знака получает знак своей оси.
  axis_epochs:
    '<path d="M5 2.6h6"/><path d="M5 13.4h6"/><path d="M5.8 2.6c0 3 4.4 3.6 4.4 5.4 0 1.8-4.4 2.4-4.4 5.4"/>' +
    '<path d="M10.2 2.6c0 3-4.4 3.6-4.4 5.4 0 1.8 4.4 2.4 4.4 5.4"/>',
  axis_styles:
    '<path d="M8 2.4 9.5 6.1l3.9-.3-3 2.7.9 3.8L8 10.6l-3.3 1.7.9-3.8-3-2.7 3.9.3z" fill="currentColor" fill-opacity="0.22" stroke="none"/>' +
    '<path d="M8 2.4 9.5 6.1l3.9-.3-3 2.7.9 3.8L8 10.6l-3.3 1.7.9-3.8-3-2.7 3.9.3z"/>',
  axis_methods:
    '<circle cx="8" cy="8" r="5.4"/><path d="M8 2.6v5.6l3.4 2"/>',
  axis_traits:
    '<path d="M2.4 9.6 8 4.4l5.6 5.2"/><path d="M2.4 13.4h11.2"/><path d="M4.6 13.4v-1.8" stroke-width="1"/>',
};

/** Запасные знаки по осям: понятие без своего знака получает знак оси. */
export const AXIS_FALLBACK_ICON: Record<ConceptAxis, string> = {
  art_epochs: "axis_epochs",
  art_styles: "axis_styles",
  form_method: "axis_methods",
  morphological_trait: "axis_traits",
};

/** Все ключи знаков понятий — 101 штука, по реестру. */
export const CONCEPT_ICON_KEYS: readonly string[] = Object.freeze(
  Object.keys(ICON_PATHS).filter((key) => !key.startsWith("axis_")),
);

/** Ключи запасных знаков осей. */
export const AXIS_FALLBACK_KEYS: readonly string[] = Object.freeze(
  Object.keys(ICON_PATHS).filter((key) => key.startsWith("axis_")),
);

/** Есть ли свой знак у понятия. */
export function hasConceptIcon(key: string | null | undefined): boolean {
  return typeof key === "string" && Object.prototype.hasOwnProperty.call(ICON_PATHS, key);
}

/**
 * Внутренняя разметка знака (без обёртки `<svg>`).
 * Неизвестный ключ даёт запасной знак оси, а если и его нет — знак эпохи:
 * пустой знак в чипах недопустим.
 */
export function conceptIconPaths(
  key: string | null | undefined,
  axis: ConceptAxis = "art_epochs",
): string {
  const direct = typeof key === "string" ? ICON_PATHS[key] : undefined;
  if (direct) return direct;
  const fallback = ICON_PATHS[AXIS_FALLBACK_ICON[axis] ?? AXIS_FALLBACK_ICON.art_epochs];
  return fallback ?? ICON_PATHS.axis_epochs;
}

/**
 * Готовый знак для вставки в разметку: `<svg>` с `currentColor`.
 * Гость без JavaScript видит знак так же, как редактор.
 */
export function conceptIconSvg(
  key: string | null | undefined,
  axis: ConceptAxis = "art_epochs",
  options: { size?: number; className?: string } = {},
): string {
  const size = options.size ?? CONCEPT_ICON_SIZE;
  const className = options.className ?? CONCEPT_ICON_CLASS;
  return (
    `<svg class="${className}" viewBox="${CONCEPT_ICON_VIEW_BOX}" width="${size}" height="${size}"` +
    ` fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"` +
    ` aria-hidden="true" focusable="false">${conceptIconPaths(key, axis)}</svg>`
  );
}

/** Запасной знак оси — как готовый `<svg>`. */
export function axisFallbackIconSvg(
  axis: ConceptAxis,
  options: { size?: number; className?: string } = {},
): string {
  return conceptIconSvg(AXIS_FALLBACK_ICON[axis] ?? "axis_epochs", axis, options);
}
