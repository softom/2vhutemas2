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
  /** Версия контракта: клиент сверяет её через GET /capabilities. */
  contractVersion: "1.0.0-draft",
  blockNoteSchemaVersion: 1,
} as const;
