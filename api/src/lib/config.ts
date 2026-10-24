/**
 * Конфигурация сервиса.
 *
 * Значения приходят из окружения контейнера. Пустое обязательное значение
 * останавливает запуск: параметр безопасности без значения не превращается
 * в «без ограничений» (правило параметров проекта).
 */

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value || value.trim() === "") {
    throw new Error(`Не задана обязательная переменная окружения ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = Deno.env.get(name);
  return value && value.trim() !== "" ? value : fallback;
}

export const config = {
  port: Number(optional("PORT", "8000")),
  db: {
    host: optional("APP_API_DB_HOST", "supa_db"),
    port: Number(optional("APP_API_DB_PORT", "5432")),
    database: optional("APP_API_DB_NAME", "postgres"),
    user: optional("APP_API_DB_USER", "app_api"),
    password: required("APP_API_DB_PASSWORD"),
    maxConnections: Number(optional("APP_API_DB_POOL", "10")),
  },
  auth: {
    /** Секрет подписи токенов Supabase. Проверяется на каждом запросе. */
    jwtSecret: required("JWT_SECRET"),
  },
  /** Разрешённые источники запросов; звёздочка допустима только в разработке. */
  corsOrigins: optional("CORS_ORIGINS", "http://localhost:5173").split(",").map((o) => o.trim()),
  pagination: {
    defaultPageSize: Number(optional("API_PAGE_SIZE_DEFAULT", "24")),
    maxPageSize: Number(optional("API_PAGE_SIZE_MAX", "100")),
  },
  media: {
    /** Корень собственного хранилища нового контура (решение Р-22). */
    root: optional("MEDIA_ROOT", "/data"),
    maxBytes: Number(optional("MEDIA_MAX_BYTES", String(1024 * 1024 * 1024))),
    maxPixels: Number(optional("MEDIA_MAX_PIXELS", "400000000")),
    allowedMimeTypes: optional(
      "MEDIA_ALLOWED_MIME",
      "image/jpeg,image/png,image/gif,image/webp,image/avif,image/tiff,image/heic,application/pdf,video/mp4,image/vnd.dxf",
    ).split(",").map((t) => t.trim()),
    screenMaxEdge: Number(optional("MEDIA_SCREEN_MAX_EDGE", "1600")),
    thumbnailMaxEdge: Number(optional("MEDIA_THUMBNAIL_MAX_EDGE", "400")),
    quality: Number(optional("MEDIA_QUALITY", "82")),
    recipeVersion: optional("MEDIA_RECIPE_VERSION", "v2"),
  },
  /**
   * Поиск (Р-109). Векторы — через Polza.AI; без ключа поиск только по словам.
   * Размерность закреплена таблицей (vector(1536)): другая модель режется
   * до неё параметром dimensions.
   */
  search: {
    apiKey: Deno.env.get("POLZA_API_KEY")?.trim() || null,
    baseUrl: optional("POLZA_BASE_URL", "https://api.polza.ai/api/v1"),
    model: optional("SEARCH_EMBED_MODEL", "openai/text-embedding-3-large"),
    dimensions: 1536,
    batchSize: Number(optional("SEARCH_EMBED_BATCH", "64")),
    intervalMs: Number(optional("SEARCH_INDEX_INTERVAL_MS", "15000")),
    /**
     * Ответ ИИ в поиске (Р-114) — настройки сайта. Аудитория сужается без
     * правки кода: all — всем, registered — вошедшим, editors — правящим,
     * off — выключено. Лимит — ответов на человека в сутки (гостю — по
     * суточному псевдониму); общий потолок бережёт баланс от обхода лимита.
     */
    ai: {
      audience: optional("SEARCH_AI_AUDIENCE", "all") as "all" | "registered" | "editors" | "off",
      dailyLimit: Number(optional("SEARCH_AI_DAILY_LIMIT", "50")),
      dailyTotal: Number(optional("SEARCH_AI_DAILY_TOTAL", "1000")),
      model: optional("SEARCH_AI_MODEL", "deepseek/deepseek-v4-pro"),
      passages: Number(optional("SEARCH_AI_PASSAGES", "10")),
    },
  },
  /**
   * Материалы в работе (0051, 0052): папки в Dropbox. Приложение Dropbox с
   * доступом «Full Dropbox», корень DROPBOX_ROOT=/2VHUTEMAS; ключи — только в .env
   * сервера. Без ключей кнопка «Обновить файловую структуру» отвечает 503.
   */
  dropbox: {
    appKey: Deno.env.get("DROPBOX_APP_KEY")?.trim() || null,
    appSecret: Deno.env.get("DROPBOX_APP_SECRET")?.trim() || null,
    refreshToken: Deno.env.get("DROPBOX_REFRESH_TOKEN")?.trim() || null,
    /** Корень внутри папки приложения; "" — сама папка приложения. */
    root: optional("DROPBOX_ROOT", ""),
  },
  /** Версия контракта: клиент сверяет её через GET /capabilities. */
  contractVersion: "1.0.0-draft",
  blockNoteSchemaVersion: 1,
} as const;
