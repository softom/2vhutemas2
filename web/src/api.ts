/**
 * Клиент API нового контура.
 *
 * Клиент не обращается к базе напрямую: только к нашему API (решение Р-02).
 * Токен выдаёт Supabase Auth, здесь он только прикладывается к запросу.
 */
import { createClient, type Session } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const API_BASE = (import.meta.env.VITE_API_BASE as string) ?? "/api/v1";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export class ApiError extends Error {
  code: string;
  details: unknown;
  requestId: string;
  constructor(code: string, message: string, details: unknown, requestId: string) {
    super(message);
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

/** Пометка на странице сайта (Р-95); ответы ветки — в `replies`. */
export interface PageNote {
  id: string;
  page_path: string;
  parent_id: string | null;
  kind: "comment" | "sticky" | "text" | "pen" | "rect" | "arrow" | "reply";
  anchor: NoteAnchor;
  geometry: NoteGeometry;
  body: string;
  color: string;
  viewport_width: number | null;
  status: "open" | "resolved";
  created_at: string;
  created_by: string | null;
  author: string | null;
  replies?: PageNote[];
}

/** Элемент страницы и точка в нём — в долях его рамки; запасной ход — точка документа. */
export interface NoteAnchor {
  selector?: string;
  x?: number;
  y?: number;
  pageX?: number;
  pageY?: number;
}

/** Форма в долях рамки элемента привязки: точки карандаша, конец рамки и стрелки. */
export interface NoteGeometry {
  points?: [number, number][];
  x2?: number;
  y2?: number;
}

async function token(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const accessToken = await token();
  if (accessToken) headers.set("authorization", `Bearer ${accessToken}`);
  if (init.body && !(init.body instanceof FormData)) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = payload?.error ?? {};
    throw new ApiError(
      error.code ?? "unknown",
      error.message ?? "Не удалось выполнить запрос",
      error.details ?? null,
      error.request_id ?? "",
    );
  }
  return payload as T;
}

async function requestBlob(path: string): Promise<string> {
  const headers = new Headers();
  const accessToken = await token();
  if (accessToken) headers.set("authorization", `Bearer ${accessToken}`);
  const response = await fetch(`${API_BASE}${path}`, { headers });
  if (!response.ok) throw new ApiError("not_found", "Картинка недоступна", null, "");
  return URL.createObjectURL(await response.blob());
}

/** Узел дерева типов: вид записи — его корневая ветвь (Р-37). */
export interface EntityType {
  code: string;
  title_ru: string;
  depth: number;
  parent: string | null;
}

/**
 * Компонент компактного вида записи с готовым значением: миниатюра или
 * портрет — с номером файла обложки, параметр — со значением.
 */
export interface CompactItem {
  component: string;
  asset?: string | null;
  /** Внешний кадр, когда обложки нет: превью ролика (тип «Видео»). */
  src?: string | null;
  parameter?: string;
  value?: string | null;
}

/**
 * Что показать компактно: изображение и его форма, знак, значения.
 * Двойник `compactParts` сервера (api/src/lib/blocksHtml.ts): правила одни,
 * менять оба. Разметка сводит компактный вид к картинке, знаку и параметрам —
 * порядок параметров берётся из таблицы, порядок остальных частей постоянный.
 */
export function compactParts(compact: CompactItem[] | undefined) {
  const items = compact ?? [];
  const picture = items.find((item) => item.component === "thumbnail" || item.component === "portrait");
  return {
    picture: !!picture,
    image: picture?.asset ?? null,
    src: picture?.asset ? null : picture?.src ?? null,
    portrait: picture?.component === "portrait",
    mark: items.some((item) => item.component === "mark"),
    params: items.filter((item) => item.component === "parameter" && item.value).map((item) => String(item.value)),
  };
}

/** Адрес изображения компактного вида: файл медиатеки или внешний кадр. */
export function compactPicture(
  view: ReturnType<typeof compactParts>,
  variant: "thumbnail" | "screen",
): string | null {
  return view.image ? api.mediaFileUrl(view.image, variant) : view.src;
}

export interface EntityListItem {
  id: number;
  slug: string;
  type: string;
  type_title: string | null;
  /** Путь по дереву от корневой ветви вниз. */
  type_path: { code: string; title: string }[];
  title_ru: string;
  title_en: string | null;
  is_published: boolean;
  material_status: string | null;
  /** Первое по порядку прикреплённое изображение; пусто, если файлов нет. */
  cover_asset_id: string | null;
  /** Компактный вид записи по её типу (таблица отображений). */
  compact?: CompactItem[];
  /** Значение величины, по которой шёл отбор; приходит только с ?parameter=. */
  parameter_value?: number | string | null;
  parameter_text?: string | null;
  /** Значения величин, названных в ?values=; пусто, если их не просили. */
  values?: Record<string, string | number | boolean | null>;
}

/** Найденная запись (Р-109): где найдено, фрагмент, совпало ли по словам или по смыслу. */
export interface SearchHit {
  id: number;
  slug: string;
  title_ru: string;
  type: string;
  type_title: string | null;
  type_path: { code: string; title: string }[];
  status: string;
  found_in: "title" | "params" | "text";
  block_id: string | null;
  /** Совпавшие слова — между U+E000 и U+E001; текст не экранирован. */
  snippet: string | null;
  matched: ("fulltext" | "vector")[];
  similarity: number | null;
  score: number;
  compact?: CompactItem[];
}

export interface EntityCard extends EntityListItem {
  title_original: string | null;
  title_la: string | null;
  profile: Record<string, unknown>;
  material_id: string | null;
  latest_revision_id: string | null;
  /** Источники записи; гостю — только опубликованные (Р-65). */
  sources?: EntitySource[];
  /** Подписи авторов материала — для ссылки «как цитировать». */
  authors?: string[];
  canonical_url?: string;
  citation?: { url: string; accessed: string; gost: string; apa: string };
}

export interface EntitySource {
  id: number;
  kind: string;
  kind_title: string;
  title: string | null;
  text: string | null;
  url: string | null;
  year: number | null;
}

export interface MediaAsset {
  id: string;
  asset_class: string;
  caption_ru: string | null;
  credit: string | null;
  visibility: string;
  /** Не указано, кому приписать или откуда взято: задача редактора (Р-68). */
  needs_attribution?: boolean;
  /** Вид изображения (код), автор — для подписи в окне вставки. */
  kind?: string | null;
  author?: string | null;
  files: Record<string, { status: string; width: number | null; height: number | null }> | null;
}

export interface Place {
  id: string;
  country: string | null;
  settlement: string | null;
  street: string | null;
  house: string | null;
  unit: string | null;
  lat: number | null;
  lon: number | null;
  precision: string;
}

/**
 * Подпись места собирается из элементов адреса и нигде не хранится:
 * иначе получится второй источник одного сведения.
 */
export function placeLabel(place: Partial<Place>): string {
  const line = [place.street, place.house, place.unit].filter(Boolean).join(", ");
  const label = [place.country, place.settlement, line].filter(Boolean).join(", ");
  if (label) return label;
  return place.lat !== null && place.lat !== undefined
    ? `${place.lat}, ${place.lon}`
    : "место без сведений";
}


/** Значение величины внутри показателей (Р-38). */
export interface IndicatorValue {
  parameter: string;
  title?: string;
  unit?: string | null;
  value_type?: string;
  num_value?: number | string | null;
  text_value?: string | null;
  bool_value?: boolean | null;
  option?: string | null;
  option_title?: string | null;
  /** Место из справочника: величина с типом «место» (Р-39). */
  place_id?: string | null;
  place?: Place | null;
  date_start_year?: number | null;
  date_end_year?: number | null;
  is_approximate?: boolean;
  is_ongoing?: boolean;
  note?: string | null;
}

/** Одно измерение целиком: «по проекту», «после реконструкции». */
export interface Indicator {
  id?: string;
  title: string;
  is_current: boolean;
  measured_year?: number | null;
  measured_by?: string | null;
  note?: string | null;
  values: IndicatorValue[];
}

/** Параметр, подсказанный записи её ветвью дерева и наборами. */
export interface SuggestedParameter {
  parameter: string;
  title: string;
  unit: string | null;
  value_type: string;
  definition: string | null;
  set: string;
  set_title: string;
  hint: string | null;
  /** У вопроса бывает несколько ответов: две реконструкции, два адреса. */
  is_repeatable?: boolean;
  options: { code: string; title: string }[];
}

export interface ParameterRow {
  id: string;
  code: string;
  title_ru: string;
  unit: string | null;
  value_type: string;
  definition: string | null;
  sort_order: number;
  /** У вопроса бывает несколько ответов: две реконструкции, два адреса. */
  is_repeatable: boolean;
  options: { code: string; title: string }[];
  used: number | string;
}

export interface ParameterSetRow {
  id: string;
  code: string;
  title_ru: string;
  note: string | null;
  items: {
    code: string;
    title_ru: string;
    unit: string | null;
    value_type: string;
    definition: string | null;
    is_repeatable: boolean;
    hint: string | null;
  }[];
  types: { code: string; title: string }[];
}

export interface Capabilities {
  contract_version: string;
  limits: Record<string, unknown>;
  /** Дерево типов в порядке обхода сверху вниз. */
  entity_types: EntityType[];
  /** Ветви вне общего каталога «Всё» и его кнопок отбора (сервер: CATALOG_HIDDEN_ROOTS). */
  catalog_hidden_roots?: string[];
  dictionaries: Record<string, { code: string; title_ru: string }[]>;
  /** Вид записи по типу: компоненты режимов compact, card и editor. */
  presentations?: Record<string, Record<string, { component: string; parameter: string | null }[]>>;
}

/** Робот новостей (страница su): прогоны и кандидаты в источники. */
export interface RobotRunRow {
  id: string;
  finished_at?: string;
  since?: string;
  status: string;
  llm_note?: string | null;
  counts?: Record<string, number>;
}
export interface RobotSourceCandidate {
  domain: string;
  url?: string;
  status: string;
  proposed_by?: "robot" | "editor";
  note?: string | null;
  count?: number;
  kinds?: Record<string, number>;
  examples?: { url: string; about?: string | null; story?: string }[];
  probe?: { title?: string | null; lang?: string | null; feed?: string | null; per_week?: number; newest?: string | null; samples?: string[]; note?: string | null } | null;
  assessment?: { title?: string; kind?: string; recommend?: string; topics?: string[]; trust?: number; reason?: string } | null;
  decided_at?: string;
  decision_note?: string | null;
}
export interface RobotRun {
  id: string;
  status: string;
  since: string;
  finished_at: string;
  llm_note: string | null;
  counts: Record<string, number>;
  feeds: { id: string; title: string; feed: string; status: string; items: number; new: number; newest: string | null }[];
  candidates: { story_key: string; final: number; interest: number; title_ru: string; topic?: string; kind?: string; competition?: boolean; students_eligible?: boolean | null; reason?: string; sources: { source: string; url: string; date: string }[] }[];
  news: { candidate: { story_key: string; final: number }; news?: { title?: string; lead?: string; paragraphs?: string[]; more?: string; images?: { url: string; caption?: string }[] } | null; issues: string[]; warnings: string[] }[];
  link_domains: { domain: string; count: number; kinds: Record<string, number>; known: boolean; examples: { url: string; about?: string | null }[] }[];
  judged?: Record<string, "yes" | "no">;
}
/** Строка журнала робота и живое состояние прогона. */
export interface RobotLogLine {
  ts?: string;
  level?: string;
  stage?: string;
  msg: string;
  [key: string]: unknown;
}
export interface RobotProgress {
  run_id: string;
  stage: string;
  msg: string;
  ts: string;
  feeds: number;
  items: number;
  candidates: number;
  news: number;
}
export interface RobotSourceRow {
  id: string;
  title: string;
  site?: string;
  feed?: string | null;
  list_url?: string | string[] | null;
  lang?: string;
  topics: string[];
  trust?: number;
  enabled: boolean;
  vendor: boolean;
  filters: Record<string, unknown>;
  note?: string | null;
  origin: string;
  last_checked?: string | null;
  last_item?: string | null;
  fail_count: number;
  last_error?: string | null;
}
/** Раздел «Робот»: сводка, вид прогона, стек (Р-96). */
export interface RobotQueueItem { story_key: string; run_id?: string; title?: string; topic?: string; final?: number; url?: string; date: string; time: string; by?: string }
export interface RobotQueue { items: RobotQueueItem[]; times: string[]; days: string[] }
export interface RobotOverview {
  connected: boolean;
  runs: { id: string; done: boolean; started_at?: string }[];
  sources: RobotSourceRow[];
  candidates: RobotSourceCandidate[];
  judged: Record<string, "yes" | "no">;
  pending: { action: string; domain?: string; url?: string; story_key?: string; verdict?: string; decision?: string }[];
  learned: RobotLearned;
  queue: RobotQueue;
  prepared: Record<string, RobotPrepared>;
  orders_pending?: { story_key: string; topic: string; section: string; urls: string[]; at: string }[];
}
/** Состояние робота (Р-103): сбор, минутное задание, LLM. */
export interface RobotLlmCall { ts: string; stage: string; model?: string; where?: string; ok: boolean; error?: string; ms?: number; prompt_tokens?: number; completion_tokens?: number }
export interface RobotHealth {
  now: string;
  crawl: { run_id?: string; started_at?: string; last_at?: string | null; state: string; stage?: string | null; msg?: string | null; stages?: Record<string, [number, number]> | null; next_at?: string };
  worker: { last_at: string | null; age_s: number | null; doing: string | null; state: string };
  llm: { model: string | null; last: RobotLlmCall | null; age_s: number | null; state: string;
    day: { calls: number; errors: number; prompt_tokens: number; completion_tokens: number }; recent: RobotLlmCall[] };
}
/** Подготовка новости из стека (Р-97). */
export interface RobotPrepared { publication?: string; status: string; ready_at?: string; started_at?: string; error?: string; origin?: string; title?: string; issues?: string[];
  order?: { topic?: string; section?: string; by?: string; at?: string };
  cover?: { status?: string; started_at?: string; pending?: { action: string; at: string } } }
export interface RobotCover {
  status?: string; idea_ru?: string; prompt?: string; alt_ru?: string; model?: string; error?: string;
  chosen?: string; applied_at?: string; variants?: { file: string; model: string; prompt: string; at: string }[];
  started_at?: string; pending?: { action: string; at: string }; style_key?: string; style_name?: string;
}
export interface RobotPreparedFull extends RobotPrepared {
  story_key: string;
  cover?: RobotCover;
  entity_id?: number;
  story?: {
    news?: { title?: string; lead?: string; paragraphs?: string[]; more?: string; images?: { url: string; caption?: string; credit?: string }[];
      mentions?: { name: string }[]; sources?: { url: string; title?: string }[] };
    candidate?: { sources?: { source: string; url: string; date?: string }[] };
    source?: Record<string, unknown>;
    issues?: string[]; warnings?: string[];
  };
}
export interface RobotStory {
  story_key: string; final: number; interest: number; title_ru: string; topic?: string; kind?: string;
  competition?: boolean; reason?: string; sources: { source: string; url: string; date?: string }[];
}
export interface RobotRunView {
  id: string; running: boolean; status: string; since?: string; llm_note: string | null;
  last: { ts?: string; stage?: string; msg?: string };
  stages: Record<string, [number, number]>;
  items: number;
  feeds: { id: string; title: string; status: string; items: number; new: number }[];
  candidates: RobotStory[];
  partial: { id?: string; story_key?: string; interest?: number; title_ru?: string; title?: string; topic?: string; kind?: string; reason?: string; source?: string; url?: string; competition?: boolean }[];
  news: { candidate: { story_key: string; final: number }; news?: { title?: string; lead?: string; paragraphs?: string[]; more?: string; images?: { url: string; caption?: string }[] } | null; issues: string[]; warnings: string[] }[];
  link_domains: RobotRun["link_domains"];
  errors: RobotLogLine[];
}
/** Чему робот научился по решениям редактора (Р-93). */
export interface RobotLearned {
  profile_text?: string;
  profile?: { likes?: string[]; dislikes?: string[]; surprises?: string[]; repetition?: string; changed?: string };
  adjustments?: { base_rate: number; n: number; kind: Record<string, number>; topic: Record<string, number>; per_extra_source?: number };
  judged_at_calibration?: number;
  history?: { at: string; judged: number; agreement: { precision: number | null; hits: number; total: number } }[];
}

export const api = {
  siteHeader: (path: string) => request<{ html: string; footer: string; viewer: { authenticated: boolean; displayName: string; permissions: string[] } }>(`/site-header?path=${encodeURIComponent(path)}`),
  // Пометки поверх страниц (Р-95): только для правящих.
  pageNotes: (path: string, all = false) =>
    request<{ items: PageNote[] }>(`/page-notes?path=${encodeURIComponent(path)}${all ? "&status=all" : ""}`),
  openPageNotes: () => request<{ items: { page_path: string; open: number; last_at: string }[] }>("/page-notes/open"),
  createPageNote: (note: Partial<PageNote> & { parent_id?: string }) =>
    request<{ id: string }>("/page-notes", { method: "POST", body: JSON.stringify(note) }),
  updatePageNote: (id: string, patch: Partial<Pick<PageNote, "body" | "status" | "color" | "geometry" | "anchor">>) =>
    request<{ ok: boolean }>(`/page-notes/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deletePageNote: (id: string) => request<void>(`/page-notes/${id}`, { method: "DELETE" }),
  capabilities: () => request<Capabilities>("/capabilities"),
  me: () =>
    request<{ authenticated: boolean; display_name?: string; permissions: string[] }>("/me"),

  search: (params: { q: string; kind?: string; type?: string; limit?: number }) => {
    const search = new URLSearchParams({ q: params.q });
    if (params.kind) search.set("kind", params.kind);
    if (params.type) search.set("type", params.type);
    if (params.limit) search.set("limit", String(params.limit));
    return request<{ items: SearchHit[]; mode: "hybrid" | "fulltext" }>(`/search?${search}`);
  },

  entities: (
    params: {
      type?: string;
      q?: string;
      cursor?: string;
      parameter?: string;
      min?: string;
      max?: string;
      sort?: string;
      order?: string;
      /** Коды величин, значения которых нужны в списке. */
      values?: string;
      limit?: string;
    },
  ) => {
    const search = new URLSearchParams();
    // Отбор по ветви целиком: корневая ветвь — это прежний фильтр по виду.
    if (params.type) search.set("type", params.type);
    if (params.q) search.set("q", params.q);
    if (params.cursor) search.set("cursor", params.cursor);
    // Отбор и сортировка по величине считаются по действующим показателям.
    if (params.parameter) search.set("parameter", params.parameter);
    if (params.min) search.set("min", params.min);
    if (params.max) search.set("max", params.max);
    if (params.sort) search.set("sort", params.sort);
    if (params.order) search.set("order", params.order);
    if (params.values) search.set("values", params.values);
    if (params.limit) search.set("limit", params.limit);
    return request<{ items: EntityListItem[]; next_cursor: string | null }>(
      `/entities?${search.toString()}`,
    );
  },
  /** Запись по номеру или по адресу — текущему или прежнему (Р-65). */
  entity: (id: number | string) =>
    request<EntityCard>(`/entities/${encodeURIComponent(String(id))}`),
  entityCardHtml: (id: number | string) =>
    request<{ html: string; title: string; path: string }>(`/entities/${encodeURIComponent(String(id))}/card`),
  entityVersions: (id: number) => request<{items:{id:string;created_at:string;summary:string;editor:string|null;is_public:boolean;is_working:boolean;complete:boolean}[]}>(`/entities/${id}/versions`),
  /** Снять запись с публикации: обратно в черновик, версии сохраняются. */
  unpublishEntity: (id: number) =>
    request<{ entity_id: number; status: "draft" }>(`/entities/${id}/unpublish`, { method: "POST", body: JSON.stringify({}) }),
  publishMaterial: (id: string, revision_id: string) => request(`/materials/${id}/publish`, {method:"POST", body:JSON.stringify({revision_id})}),
  submitMaterial: (id: string) => request(`/materials/${id}/submit`, {method:"POST", body:JSON.stringify({})}),
  createEntity: (body: unknown) =>
    request<{ id: number; material_id:string; revision_id: string }>("/entities", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateEntity: (id: number, body: unknown) =>
    request<{ id: number; material_id:string; revision_id: string }>(`/entities/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  saveIndicators: (id: number, items: Indicator[], baseRevisionId: string | null) =>
    request<{ items: Indicator[]; revision_id: string | null }>(`/entities-indicators/${id}`, {
      method: "PUT",
      body: JSON.stringify({ indicators: items, base_revision_id: baseRevisionId }),
    }),

  parameters: () => request<{ items: ParameterRow[] }>("/parameters"),
  robotRuns: () => request<{ items: RobotRunRow[]; connected: boolean }>("/news-robot/runs"),
  robotRun: (id: string) => request<RobotRun>(`/news-robot/runs/${encodeURIComponent(id)}`),
  robotLog: (id: string, from: number) =>
    request<{ items: RobotLogLine[]; next: number; total: number; progress: RobotProgress | null; running: boolean }>(
      `/news-robot/runs/${encodeURIComponent(id)}/log?from=${from}`,
    ),
  robotSources: () => request<{ items: RobotSourceRow[]; connected: boolean }>("/news-robot/sources"),
  robotOverview: () => request<RobotOverview>("/news-robot/overview"),
  robotHealth: () => request<RobotHealth>("/news-robot/health"),
  robotStories: (days = 14) =>
    request<{ items: (RobotStory & { run_id: string; run_started: string; written: boolean })[]; days: number }>(
      `/news-robot/stories?days=${days}`,
    ),
  robotOrder: (body: { topic: string; section: string; input: string; note?: string }) =>
    request<{ queued: { story_key: string } }>("/news-robot/order", { method: "POST", body: JSON.stringify(body) }),
  robotPrepared: (key: string) => request<RobotPreparedFull>(`/news-robot/prepared/${encodeURIComponent(key)}`),
  robotCoverStyles: () => request<{ groups: { key: string; title: string; task?: string;
    artists: { key: string; name: string; years?: string; take?: string }[] }[] }>("/news-robot/cover-styles"),
  robotCover: (body: { story_key: string; action: "draft" | "generate" | "apply"; prompt?: string; model?: string; file?: string; style?: string }) =>
    request<{ queued: unknown }>("/news-robot/cover", { method: "POST", body: JSON.stringify(body) }),
  /** Картинка варианта обложки: маршрут только для su, поэтому — с токеном, как объект URL. */
  robotCoverImage: (file: string) => requestBlob(`/news-robot/covers/${encodeURIComponent(file)}`),
  robotRegenerate: (body: { story_key: string; input?: string; note?: string }) =>
    request<{ queued: unknown }>("/news-robot/regenerate", { method: "POST", body: JSON.stringify(body) }),
  robotRunView: (id: string) => request<RobotRunView>(`/news-robot/runs/${encodeURIComponent(id)}/view`),
  robotQueue: (body: { action: "add" | "move" | "remove"; story_key: string; [key: string]: unknown }) =>
    request<RobotQueue>("/news-robot/queue", { method: "POST", body: JSON.stringify(body) }),
  robotCandidates: () =>
    request<{ items: RobotSourceCandidate[]; pending: { action: string; domain?: string; url?: string; decision?: string; story_key?: string; verdict?: string }[]; learned: RobotLearned | null }>("/news-robot/candidates"),
  robotInbox: (body:
    | { action: "decide"; domain: string; decision: "include" | "once" | "reject"; note?: string }
    | { action: "propose"; url: string; note?: string }
    | { action: "judge"; run_id: string; story_key: string; verdict: "yes" | "no"; note?: string }) =>
    request<{ queued: unknown }>("/news-robot/inbox", { method: "POST", body: JSON.stringify(body) }),
  parametersForType: (code: string) =>
    request<{ items: SuggestedParameter[] }>(`/parameters/for-type/${code}`),
  parametersForEntity: (id: number) =>
    request<{ items: SuggestedParameter[] }>(`/entities/${id}/parameters`),
  attachParameterSetToEntity: (code: string, entityId: number) =>
    request<{ set: string; entity_id: number }>(`/parameter-sets/${code}/entities`, {
      method: "POST",
      body: JSON.stringify({ entity_id: entityId }),
    }),
  detachParameterSetFromEntity: (code: string, entityId: number) =>
    request<void>(`/parameter-sets/${code}/entities/${entityId}`, { method: "DELETE" }),
  createParameter: (body: unknown) =>
    request<{ id: string }>("/parameters", { method: "POST", body: JSON.stringify(body) }),
  updateParameter: (id: string, body: unknown) =>
    request<ParameterRow>(`/parameters/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteParameter: (id: string) =>
    request<void>(`/parameters/${id}`, { method: "DELETE" }),
  parameterSets: () => request<{ items: ParameterSetRow[] }>("/parameter-sets"),
  updateParameterSet: (code: string, body: unknown) =>
    request<{ code: string; title_ru: string }>(`/parameter-sets/${code}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteParameterSet: (code: string) =>
    request<void>(`/parameter-sets/${code}`, { method: "DELETE" }),
  createParameterSet: (body: unknown) =>
    request<{ id: string }>("/parameter-sets", { method: "POST", body: JSON.stringify(body) }),
  setParameterSetItems: (
    code: string,
    items: { parameter: string; hint?: string | null }[],
  ) =>
    request<{ set: string; items: number }>(`/parameter-sets/${code}/items`, {
      method: "PUT",
      body: JSON.stringify({ items }),
    }),
  attachParameterSet: (code: string, type: string) =>
    request<{ set: string; type: string }>(`/parameter-sets/${code}/types`, {
      method: "POST",
      body: JSON.stringify({ type }),
    }),
  detachParameterSet: (code: string, type: string) =>
    request<void>(`/parameter-sets/${code}/types/${type}`, { method: "DELETE" }),

  document: (id: number) =>
    request<{ id: number; title: string; body_json: unknown; latest_revision_id: string }>(
      `/documents/${id}`,
    ),
  createDocument: (body: unknown) =>
    request<{ id: number; material_id:string; revision_id: string }>("/documents", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateDocument: (id: number, body: unknown) =>
    request<{ id: number; material_id:string; revision_id: string }>(`/documents/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  links: (entityId: number) =>
    request<{ items: Record<string, unknown>[] }>(`/links?entity_id=${entityId}`),
  createLink: (body: unknown) =>
    request<{ id: number; document_id: number }>("/links", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteLink: (id: number) => request<void>(`/links/${id}`, { method: "DELETE" }),
  mentions: (entityId: number) =>
    request<{ items: Record<string, unknown>[] }>(`/links/mentions?entity_id=${entityId}`),

  tags: (query: string) =>
    request<{ items: { id: string; title: string; usages: number }[] }>(
      `/tags?q=${encodeURIComponent(query)}`,
    ),
  setEntityTags: (entityId: number, titles: string[]) =>
    request<{ items: { id: string; title: string }[] }>(`/tags/entities/${entityId}`, {
      method: "PUT",
      body: JSON.stringify({ tags: titles }),
    }),
  setMediaTags: (assetId: string, titles: string[]) =>
    request<{ items: { id: string; title: string }[] }>(`/tags/media/${assetId}`, {
      method: "PUT",
      body: JSON.stringify({ tags: titles }),
    }),

  createPlace: (body: unknown) =>
    request<{ id: string }>("/places", { method: "POST", body: JSON.stringify(body) }),
  updatePlace: (id: string, body: unknown) =>
    request<{ id: string }>(`/places/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  placeUsage: (id: string) =>
    request<{ items: Record<string, unknown>[] }>(`/places/${id}/usage`),

  places: (query: string) =>
    request<{ items: Place[] }>(`/places?q=${encodeURIComponent(query)}`),

  /** Обмен токена на куку: без неё браузер не покажет приватные файлы. */
  openMediaSession: () => request<{ expires_at: string }>("/session", { method: "POST" }),

  media: (params: {
    q?: string;
    cursor?: string;
    needsAttribution?: boolean;
    /** Вид изображения — код из словаря media_kinds. */
    kind?: string;
    /** Прикреплён ли файл к записи entityId: "yes" или "no". */
    attached?: "yes" | "no";
    entityId?: number;
  } = {}) => {
    const search = new URLSearchParams();
    if (params.q) search.set("q", params.q);
    if (params.cursor) search.set("cursor", params.cursor);
    if (params.needsAttribution) search.set("needs", "attribution");
    if (params.kind) search.set("kind", params.kind);
    if (params.attached && params.entityId) {
      search.set("attached", params.attached);
      search.set("entity_id", String(params.entityId));
    }
    return request<{
      items: MediaAsset[];
      /** Сколько файлов ждут ссылок — задача видна числом (Р-68). */
      needs_attribution: number;
      next_cursor: string | null;
    }>(`/media?${search.toString()}`);
  },
  attachMedia: (body: unknown) =>
    request<{ attachment_id: number }>("/media/attachments", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  orderMedia: (entityId: number, order: number[]) =>
    request<{ ordered: number }>("/media/attachments/order", {
      method: "PUT",
      body: JSON.stringify({ entity_id: entityId, order }),
    }),
  detachMedia: (attachmentId: number) =>
    request<void>(`/media/attachments/${attachmentId}`, { method: "DELETE" }),
  uploadMedia: (form: FormData) =>
    request<MediaAsset>("/media", { method: "POST", body: form }),
  updateMedia: (id: string, body: unknown) =>
    request<MediaAsset>(`/media/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  mediaFileUrl: (id: string, variant: "thumbnail" | "screen" | "original") =>
    `${API_BASE}/media/${id}/file?variant=${variant}`,
};

export type { Session };
