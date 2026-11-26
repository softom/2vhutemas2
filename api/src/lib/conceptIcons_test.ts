import {
  AXIS_FALLBACK_ICON,
  AXIS_FALLBACK_KEYS,
  CONCEPT_ICON_KEYS,
  conceptIconPaths,
  conceptIconSvg,
  hasConceptIcon,
} from "./conceptIcons.ts";

/** Ключи знаков по реестру «Классификация — цвета и пиктограммы» (101 понятие). */
const REGISTRY_KEYS = [
  "epoch_tradition", "epoch_fin_de_siecle", "epoch_avant_garde", "epoch_modernism",
  "epoch_postmodernism", "epoch_metamodernism",
  "style_historicism", "style_neogothic", "style_neorussian", "style_arts_crafts",
  "style_art_nouveau", "style_secession", "style_northern_nouveau", "style_rus_avantgarde",
  "style_constructivism", "style_asnova", "style_suprematism", "style_futurism",
  "style_expressionism", "style_czech_cubism", "style_de_stijl", "style_chicago",
  "style_bauhaus", "style_functionalism", "style_international", "style_euro_rationalism",
  "style_soviet_modernism", "style_minimalism", "style_art_deco", "style_streamline",
  "style_monumental_neo", "style_postconstructivism", "style_soviet_artdeco",
  "style_stalinist_empire", "style_national_socreal", "style_brutalism", "style_organic",
  "style_critical_regionalism", "style_midcentury", "style_structuralism", "style_hightech",
  "style_struct_expr", "style_metabolism", "style_googie", "style_postmodern",
  "style_deconstructivism", "style_pragmatic_icon", "style_blobitecture", "style_biomorphic",
  "style_computational", "style_parametricism",
  "method_tectonic", "method_geometric", "method_modular", "method_functional",
  "method_environmental", "method_typological", "method_plastic", "method_symbolic",
  "method_perceptual", "method_algorithmic",
  "trait_suspended_floors", "trait_concrete_core", "trait_pilotis", "trait_cantilever",
  "trait_thin_shell", "trait_diagrid", "trait_exoskeleton", "trait_membrane", "trait_glazed_vault",
  "trait_asymmetric", "trait_tilted_cylinder", "trait_stepped", "trait_intersecting",
  "trait_capsules", "trait_roof_ramp", "trait_open_stair", "trait_shards",
  "trait_biomorphic_shell", "trait_symmetry", "trait_spire", "trait_ribbon_window",
  "trait_corner_glass", "trait_curtain_wall", "trait_sawtooth", "trait_brise_soleil",
  "trait_porthole", "trait_exposed_concrete", "trait_formwork", "trait_white_plaster",
  "trait_rusticated_stone", "trait_timber_frame", "trait_metal_cladding", "trait_brickwork",
  "trait_supergraphics", "trait_epigraphy", "trait_classical_order", "trait_soviet_heraldry",
  "trait_folk_ornament", "trait_ironic_quote", "trait_mosaic_frieze",
];

Deno.test("набор знаков покрывает все 101 понятие реестра", () => {
  if (REGISTRY_KEYS.length !== 101) throw Error("Список реестра должен быть из 101 ключа");
  const missing = REGISTRY_KEYS.filter((key) => !hasConceptIcon(key));
  if (missing.length) throw Error(`Нет знаков: ${missing.join(", ")}`);
  const extra = CONCEPT_ICON_KEYS.filter((key) => !REGISTRY_KEYS.includes(key));
  if (extra.length) throw Error(`Лишние знаки: ${extra.join(", ")}`);
  if (CONCEPT_ICON_KEYS.length !== 101) {
    throw Error(`Ожидался 101 знак, получено ${CONCEPT_ICON_KEYS.length}`);
  }
});

Deno.test("ни один знак не содержит цвета, кроме currentColor", () => {
  const forbidden = /#|rgb\(|rgba\(|hsl\(|\b(red|blue|green|black|white|gray|grey|orange|purple|yellow)\b/i;
  for (const key of [...CONCEPT_ICON_KEYS, ...AXIS_FALLBACK_KEYS]) {
    const markup = conceptIconPaths(key);
    if (forbidden.test(markup)) throw Error(`Цвет в знаке ${key}: ${markup}`);
    const colors = [...markup.matchAll(/(?:fill|stroke|stop-color|flood-color)="([^"]*)"/g)].map((m) => m[1]);
    for (const color of colors) {
      if (color !== "none" && color !== "currentColor") {
        throw Error(`Недопустимый цвет "${color}" в знаке ${key}`);
      }
    }
  }
});

Deno.test("знак вставляется инлайном и красится текущим цветом", () => {
  const svg = conceptIconSvg("epoch_modernism");
  if (!svg.startsWith("<svg")) throw Error("Знак должен начинаться с <svg");
  if (!svg.includes('viewBox="0 0 16 16"')) throw Error("Нет сетки 16×16");
  if (!svg.includes('stroke="currentColor"')) throw Error("Нет currentColor");
  if (!svg.includes('fill="none"')) throw Error("Линия должна быть без заливки");
  if (!svg.includes('stroke-width="1.4"')) throw Error("Нет толщины линии 1.4");
  if (!svg.includes('aria-hidden="true"')) throw Error("Знак должен быть скрыт от чтения вслух");
  if (!svg.includes(conceptIconPaths("epoch_modernism"))) throw Error("Внутренняя разметка не вставлена");
});

Deno.test("неизвестный ключ получает запасной знак своей оси", () => {
  if (conceptIconPaths("нет_такого") !== conceptIconPaths(AXIS_FALLBACK_ICON.art_epochs)) {
    throw Error("Без оси должен встать знак эпохи");
  }
  if (conceptIconPaths("нет_такого", "form_method") !== conceptIconPaths(AXIS_FALLBACK_ICON.form_method)) {
    throw Error("Для метода должен встать знак метода");
  }
  const fallbacks = Object.values(AXIS_FALLBACK_ICON).map((key) => conceptIconPaths(key));
  if (new Set(fallbacks).size !== 4) throw Error("Запасные знаки осей должны различаться");
  if (AXIS_FALLBACK_KEYS.length !== 4) throw Error("Ожидались четыре запасных знака осей");
});

Deno.test("знаки умещаются в рабочее поле 1.5 … 14.5", () => {
  for (const key of CONCEPT_ICON_KEYS) {
    const markup = conceptIconPaths(key);
    const numbers = [...markup.matchAll(/\s([\d.]+)/g)]
      .map((m) => Number(m[1]))
      .filter((value) => Number.isFinite(value));
    for (const value of numbers) {
      if (value < 0 || value > 16) throw Error(`Координата ${value} вне сетки в знаке ${key}`);
    }
  }
});

Deno.test("заливка знака — только смысловой акцент", () => {
  for (const key of CONCEPT_ICON_KEYS) {
    const markup = conceptIconPaths(key);
    const filled = [...markup.matchAll(/fill="currentColor"/g)].length;
    // Акцент — это масса, ядро или узлы сетки; больше четырёх заливок знак
    // перестаёт читаться как рисунок и превращается в заливку.
    if (filled > 4) throw Error(`Слишком много заливки в знаке ${key}`);
    if (filled > 0 && !markup.includes('fill-opacity="')) {
      throw Error(`Заливка без прозрачности в знаке ${key}`);
    }
  }
});
