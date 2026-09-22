/**
 * Хранение файлов нового контура.
 *
 * Решение Р-22: собственное хранилище и собственный реестр. Оригинал
 * неизменяем и лежит по контрольной сумме; производные пересоздаются и
 * переключаются атомарно, поэтому лежат по идентификатору варианта.
 *
 * Правила: оригинал не перезаписывается, маленькое изображение не
 * растягивается, ориентация учитывается, ошибки обработки сохраняются
 * и допускают повтор (ТЗ, раздел о хранении изображений).
 */
import { createHash } from "node:crypto";
import { config } from "./config.ts";
import { ApiError } from "./errors.ts";

export type Variant = "original" | "screen" | "thumbnail";

/** Обёртка над ImageMagick: см. Dockerfile, она чинит пути к библиотекам. */
const MAGICK = "/usr/local/bin/magickw";

export interface StoredFile {
  storageKey: string;
  sizeBytes: number;
  sha256: string;
  mimeType: string;
  width: number | null;
  height: number | null;
}

const DERIVABLE = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "image/tiff", "image/heic", "application/pdf"]);

function extensionFor(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/avif": ".avif",
    "image/tiff": ".tif",
    "image/heic": ".heic",
    "application/pdf": ".pdf",
    "video/mp4": ".mp4",
  };
  return map[mime] ?? ".bin";
}

export function assetClassFor(mime: string): string {
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "other";
}

export function checkUpload(mime: string, sizeBytes: number): void {
  if (!config.media.allowedMimeTypes.includes(mime)) {
    throw new ApiError("validation_failed", "Этот тип файла загружать нельзя", { mime_type: mime });
  }
  if (sizeBytes > config.media.maxBytes) {
    throw new ApiError("payload_too_large", "Файл больше допустимого размера", {
      max_bytes: config.media.maxBytes,
    });
  }
}

async function run(cmd: string, args: string[]): Promise<{ ok: boolean; out: string; err: string }> {
  // Образ Deno задаёт LD_LIBRARY_PATH со своей libgcc; унаследованное значение
  // и ломает ImageMagick, и требует широких прав на запуск. Поэтому окружение
  // дочернего процесса очищаем — нужные библиотеки подставит обёртка magickw.
  const process = new Deno.Command(cmd, {
    args,
    clearEnv: true,
    env: { PATH: "/usr/bin:/bin", HOME: "/tmp" },
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await process.output();
  return {
    ok: code === 0,
    out: new TextDecoder().decode(stdout).trim(),
    err: new TextDecoder().decode(stderr).trim(),
  };
}

/** Размеры изображения; для неизображений — пусто. */
export async function probe(path: string): Promise<{ width: number | null; height: number | null }> {
  const result = await run(MAGICK, ["identify", "-format", "%w %h", `${path}[0]`]);
  if (!result.ok) return { width: null, height: null };
  const [width, height] = result.out.split(/\s+/).map(Number);
  return Number.isFinite(width) && Number.isFinite(height) ? { width, height } : { width: null, height: null };
}

/** Сохранение оригинала: пишем во временный файл, считаем сумму, кладём по ней. */
export async function storeOriginal(
  stream: ReadableStream<Uint8Array>,
  mimeType: string,
  _originalName: string,
): Promise<StoredFile> {
  await Deno.mkdir(`${config.media.root}/tmp`, { recursive: true });
  const tempPath = `${config.media.root}/tmp/${crypto.randomUUID()}`;
  const hash = createHash("sha256");
  let sizeBytes = 0;

  const file = await Deno.open(tempPath, { write: true, create: true });
  try {
    for await (const chunk of stream) {
      sizeBytes += chunk.byteLength;
      if (sizeBytes > config.media.maxBytes) {
        throw new ApiError("payload_too_large", "Файл больше допустимого размера", {
          max_bytes: config.media.maxBytes,
        });
      }
      hash.update(chunk);
      await file.write(chunk);
    }
  } finally {
    file.close();
  }

  const sha256 = hash.digest("hex");
  const { width, height } = await probe(tempPath);
  if (width && height && width * height > config.media.maxPixels) {
    await Deno.remove(tempPath).catch(() => {});
    throw new ApiError("validation_failed", "Изображение слишком большое по числу пикселей", {
      max_pixels: config.media.maxPixels,
    });
  }

  const storageKey = `orig/${sha256.slice(0, 2)}/${sha256}${extensionFor(mimeType)}`;
  const target = `${config.media.root}/${storageKey}`;
  await Deno.mkdir(target.slice(0, target.lastIndexOf("/")), { recursive: true });
  try {
    await Deno.stat(target);
    await Deno.remove(tempPath).catch(() => {});  // такие байты уже хранятся
  } catch {
    await Deno.rename(tempPath, target);
  }

  return { storageKey, sizeBytes, sha256, mimeType, width, height };
}

export function canDerive(mimeType: string): boolean {
  return DERIVABLE.has(mimeType);
}

/**
 * Производная: экранная версия или превью. Маленький оригинал не растягиваем —
 * в ImageMagick это делает суффикс «>» в размере.
 */
export async function makeDerivative(
  originalKey: string,
  assetId: string,
  variant: Exclude<Variant, "original">,
): Promise<StoredFile> {
  const source = `${config.media.root}/${originalKey}`;
  const maxEdge = variant === "screen"
    ? config.media.screenMaxEdge
    : config.media.thumbnailMaxEdge;
  const storageKey = `derived/${assetId}/${variant}-${config.media.recipeVersion}.webp`;
  const target = `${config.media.root}/${storageKey}`;
  await Deno.mkdir(target.slice(0, target.lastIndexOf("/")), { recursive: true });

  const result = await run(MAGICK, [
    `${source}[0]`,
    "-auto-orient",
    "-colorspace", "sRGB",
    "-resize", `${maxEdge}x${maxEdge}>`,
    "-quality", String(config.media.quality),
    target,
  ]);
  if (!result.ok) {
    throw new ApiError("internal_error", "Не удалось создать производное изображение", {
      variant,
      reason: result.err.slice(0, 200),
    });
  }

  const info = await Deno.stat(target);
  const { width, height } = await probe(target);
  const bytes = await Deno.readFile(target);
  return {
    storageKey,
    sizeBytes: info.size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    mimeType: "image/webp",
    width,
    height,
  };
}

export async function openStored(storageKey: string): Promise<{ file: Deno.FsFile; size: number }> {
  const path = `${config.media.root}/${storageKey}`;
  const info = await Deno.stat(path);
  return { file: await Deno.open(path, { read: true }), size: info.size };
}
