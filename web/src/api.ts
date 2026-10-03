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

/** Что показать компактно: изображение и его форма, знак, значения. */
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
  news: { candidate: { story_key: string; final: number }; news?: { title?: string; lead?: string; paragraphs?: string[]; student_note?: string; images?: { url: string; caption?: string }[] } | null; issues: string[]; warnings: string[] }[];
  link_domains: { domain: string; count: number; kinds: Record<string, number>; known: boolean; examples: { url: string; about?: string | null }[] }[];
  judged?: Record<string, "yes" | "no">;
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
  siteHeader: (path: string) => request<{ html: string; viewer: { authenticated: boolean; displayName: string; permissions: string[] } }>(`/site-header?path=${encodeURIComponent(path)}`),
  capabilities: () => request<Capabilities>("/capabilities"),
  me: () =>
    request<{ authenticated: boolean; display_name?: string; permissions: string[] }>("/me"),

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
