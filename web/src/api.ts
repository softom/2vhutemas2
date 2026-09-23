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

export interface EntityListItem {
  id: number;
  slug: string;
  kind: string;
  title_ru: string;
  title_en: string | null;
  is_published: boolean;
  material_status: string | null;
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
  title: string;
  address_line: string | null;
  settlement: string | null;
  country: string | null;
  lat: number | null;
  lon: number | null;
  precision: string;
}

export interface EntityPlace extends Place {
  attachment_id: number;
  place_id: string;
  role: string;
  role_title: string;
}

export interface Capabilities {
  contract_version: string;
  limits: Record<string, unknown>;
  dictionaries: Record<string, { code: string; title_ru: string }[]>;
}

export const api = {
  capabilities: () => request<Capabilities>("/capabilities"),
  me: () =>
    request<{ authenticated: boolean; display_name?: string; permissions: string[] }>("/me"),

  entities: (params: { kind?: string; q?: string; cursor?: string }) => {
    const search = new URLSearchParams();
    if (params.kind) search.set("kind", params.kind);
    if (params.q) search.set("q", params.q);
    if (params.cursor) search.set("cursor", params.cursor);
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

  places: (query: string) =>
    request<{ items: Place[] }>(`/places?q=${encodeURIComponent(query)}`),
  attachPlace: (body: unknown) =>
    request<{ attachment_id: number; place_id: string }>("/places/attachments", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  detachPlace: (attachmentId: number) =>
    request<void>(`/places/attachments/${attachmentId}`, { method: "DELETE" }),

  media: (cursor?: string) =>
    request<{ items: MediaAsset[]; next_cursor: string | null }>(
      `/media${cursor ? `?cursor=${cursor}` : ""}`,
    ),
  uploadMedia: (form: FormData) =>
    request<MediaAsset>("/media", { method: "POST", body: form }),
  mediaFileUrl: (id: string, variant: "thumbnail" | "screen" | "original") =>
    `${API_BASE}/media/${id}/file?variant=${variant}`,
};

export type { Session };
