/**
 * Dropbox для «Материалов в работе» (0052): создать папки и прочитать опись.
 *
 * Приложение Dropbox — с доступом «Full Dropbox» (папка 2VHUTEMAS в корне
 * Dropbox, выбор пользователя) и правами files.metadata.read/write и
 * files.content.write (Dropbox требует его для создания папки). Сайт
 * вызывает только создание папок и опись; содержимое файлов не читает и не
 * пишет. Ключи — в .env сервера, в ответы и журнал не попадают.
 */
import { config } from "./config.ts";
import { ApiError } from "./errors.ts";

let cached: { token: string; until: number } | null = null;

export function dropboxReady(): boolean {
  const d = config.dropbox;
  return !!(d.appKey && d.appSecret && d.refreshToken);
}

async function accessToken(): Promise<string> {
  if (cached && cached.until > Date.now()) return cached.token;
  const d = config.dropbox;
  if (!dropboxReady()) {
    throw new ApiError("unavailable", "Dropbox не подключён: на сервере нет ключей приложения");
  }
  const res = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token", refresh_token: d.refreshToken!, client_id: d.appKey!, client_secret: d.appSecret!,
    }),
  });
  if (!res.ok) throw new ApiError("unavailable", `Dropbox не выдал доступ (${res.status})`);
  const body = await res.json() as { access_token: string; expires_in: number };
  cached = { token: body.access_token, until: Date.now() + (body.expires_in - 300) * 1000 };
  return cached.token;
}

async function rpc<T>(endpoint: string, args: unknown): Promise<T> {
  const res = await fetch(`https://api.dropboxapi.com/2/${endpoint}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const text = (await res.text()).slice(0, 300);
    if (res.status === 409 && text.includes("not_found")) return { entries: [], has_more: false, cursor: "" } as T;
    throw new ApiError("unavailable", `Dropbox: ${endpoint} — ${res.status} ${text}`);
  }
  return await res.json() as T;
}

/** Полный путь в Dropbox для пути папки записи. */
export function dropboxPath(rel: string): string {
  const root = config.dropbox.root.replace(/^\/+|\/+$/g, "");
  return "/" + [root, rel].filter(Boolean).join("/");
}

/** Создать папки; существующие пропускаются. */
export async function createFolders(paths: string[]): Promise<void> {
  for (let i = 0; i < paths.length; i += 500) {
    const chunk = paths.slice(i, i + 500);
    let result = await rpc<{ ".tag": string; async_job_id?: string }>("files/create_folder_batch", {
      paths: chunk, autorename: false, force_async: false,
    });
    // Ответ «in_progress» номера задания не несёт — номер берётся из первого ответа.
    const job = result.async_job_id;
    while (job && (result[".tag"] === "async_job_id" || result[".tag"] === "in_progress")) {
      await new Promise((r) => setTimeout(r, 1000));
      result = await rpc("files/create_folder_batch/check", { async_job_id: job });
    }
  }
}

/** Переименовать (переместить) папки вместе с содержимым. */
export async function moveFolders(entries: { from: string; to: string }[]): Promise<void> {
  for (let i = 0; i < entries.length; i += 500) {
    const chunk = entries.slice(i, i + 500).map((e) => ({ from_path: e.from, to_path: e.to }));
    let result = await rpc<{ ".tag": string; async_job_id?: string }>("files/move_batch_v2", {
      entries: chunk, autorename: false,
    });
    const job = result.async_job_id;
    while (job && (result[".tag"] === "async_job_id" || result[".tag"] === "in_progress")) {
      await new Promise((r) => setTimeout(r, 1000));
      result = await rpc("files/move_batch/check_v2", { async_job_id: job });
    }
  }
}

export interface DropboxEntry {
  tag: "file" | "folder";
  path: string;
  size: number;
  modified: string | null;
  contentHash: string | null;
}

/** Всё содержимое корня — рекурсивно, пути без корня, регистр как в Dropbox. */
export async function listAll(): Promise<DropboxEntry[]> {
  const base = dropboxPath("");
  const cut = base === "/" ? 1 : base.length + 1;
  type Page = {
    entries: { ".tag": string; path_display: string; size?: number; server_modified?: string; content_hash?: string }[];
    has_more: boolean; cursor: string;
  };
  let page = await rpc<Page>("files/list_folder", { path: base === "/" ? "" : base, recursive: true, limit: 2000 });
  const out: DropboxEntry[] = [];
  for (;;) {
    for (const e of page.entries) {
      if (e[".tag"] !== "file" && e[".tag"] !== "folder") continue;
      const path = e.path_display.slice(cut);
      if (!path) continue;
      out.push({
        tag: e[".tag"] as "file" | "folder", path, size: e.size ?? 0,
        modified: e.server_modified ?? null, contentHash: e.content_hash ?? null,
      });
    }
    if (!page.has_more) break;
    page = await rpc<Page>("files/list_folder/continue", { cursor: page.cursor });
  }
  return out;
}
