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
  /** Значение величины, по которой шёл отбор; приходит только с ?parameter=. */
  parameter_value?: number | string | null;
  parameter_text?: string | null;
}

export interface EntityCard extends EntityListItem {
  title_original: string | null;
  title_la: string | null;
  profile: Record<string, unknown>;
  material_id: string | null;
  latest_revision_id: string | null;
}

export interface MediaAsset {
  id: string;
  asset_class: string;
  caption_ru: string | null;
  credit: string | null;
  visibility: string;
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

export interface EntityPlace extends Place {
  attachment_id: number;
  place_id: string;
  role: string;
  role_title: string;
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
  options: { code: string; title: string }[];
  used: number | string;
}

export interface ParameterSetRow {
  id: string;
  code: string;
  title_ru: string;
  note: string | null;
  items: { code: string; title_ru: string; unit: string | null; value_type: string }[];
  types: { code: string; title: string }[];
}

export interface Capabilities {
  contract_version: string;
  limits: Record<string, unknown>;
  /** Дерево типов в порядке обхода сверху вниз. */
  entity_types: EntityType[];
  dictionaries: Record<string, { code: string; title_ru: string }[]>;
}

export const api = {
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
    return request<{ items: EntityListItem[]; next_cursor: string | null }>(
      `/entities?${search.toString()}`,
    );
  },
  entity: (id: number) => request<EntityCard>(`/entities/${id}`),
  createEntity: (body: unknown) =>
    request<{ id: number; revision_id: string }>("/entities", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateEntity: (id: number, body: unknown) =>
    request<{ id: number; revision_id: string }>(`/entities/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  saveIndicators: (id: number, items: Indicator[], baseRevisionId: string | null) =>
    request<{ items: Indicator[]; revision_id: string | null }>(`/entities-indicators/${id}`, {
      method: "PUT",
      body: JSON.stringify({ indicators: items, base_revision_id: baseRevisionId }),
    }),

  parameters: () => request<{ items: ParameterRow[] }>("/parameters"),
  parametersForType: (code: string) =>
    request<{ items: SuggestedParameter[] }>(`/parameters/for-type/${code}`),
  createParameter: (body: unknown) =>
    request<{ id: string }>("/parameters", { method: "POST", body: JSON.stringify(body) }),
  updateParameter: (id: string, body: unknown) =>
    request<ParameterRow>(`/parameters/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteParameter: (id: string) =>
    request<void>(`/parameters/${id}`, { method: "DELETE" }),
  parameterSets: () => request<{ items: ParameterSetRow[] }>("/parameter-sets"),
  createParameterSet: (body: unknown) =>
    request<{ id: string }>("/parameter-sets", { method: "POST", body: JSON.stringify(body) }),
  setParameterSetItems: (code: string, items: { parameter: string; hint?: string | null }[]) =>
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
    request<{ id: number; revision_id: string }>("/documents", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateDocument: (id: number, body: unknown) =>
    request<{ id: number; revision_id: string }>(`/documents/${id}`, {
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
  attachPlace: (body: unknown) =>
    request<{ attachment_id: number; place_id: string }>("/places/attachments", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  detachPlace: (attachmentId: number) =>
    request<void>(`/places/attachments/${attachmentId}`, { method: "DELETE" }),

  /** Обмен токена на куку: без неё браузер не покажет приватные файлы. */
  openMediaSession: () => request<{ expires_at: string }>("/session", { method: "POST" }),

  media: (params: { q?: string; cursor?: string } = {}) => {
    const search = new URLSearchParams();
    if (params.q) search.set("q", params.q);
    if (params.cursor) search.set("cursor", params.cursor);
    return request<{ items: MediaAsset[]; next_cursor: string | null }>(
      `/media?${search.toString()}`,
    );
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
