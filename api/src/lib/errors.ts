/**
 * Ошибки API.
 *
 * Формат ответа одинаков для всех ошибок: code, message, details, request_id.
 * Код — машинный, латиницей; сообщение — по-русски, для человека (решение Р-18).
 * Секреты, SQL и внутренние пути в ответ не попадают.
 */

export type ErrorCode =
  | "validation_failed"
  | "unauthenticated"
  | "permission_denied"
  | "not_found"
  | "version_conflict"
  | "duplicate"
  | "link_requires_justification"
  | "payload_too_large"
  | "internal_error";

const STATUS: Record<ErrorCode, number> = {
  validation_failed: 400,
  unauthenticated: 401,
  permission_denied: 403,
  not_found: 404,
  version_conflict: 409,
  duplicate: 409,
  link_requires_justification: 422,
  payload_too_large: 413,
  internal_error: 500,
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly details: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details ?? null;
  }

  get status(): number {
    return STATUS[this.code];
  }

  toBody(requestId: string) {
    return {
      error: {
        code: this.code,
        message: this.message,
        details: this.details,
        request_id: requestId,
      },
    };
  }
}

/**
 * Разворачивает цепочку: драйвер оборачивает ошибку запроса в ошибку
 * транзакции, и без этого наружу уходит бесполезное «транзакция прервана».
 */
export function rootCause(error: unknown): unknown {
  let current = error;
  for (let depth = 0; depth < 5; depth++) {
    const cause = (current as { cause?: unknown })?.cause;
    if (!cause) break;
    current = cause;
  }
  return current;
}

/** Поля ответа PostgreSQL: код, ограничение, подробности. Секретов в них нет. */
export function pgFields(error: unknown): Record<string, string | undefined> {
  const source = rootCause(error) as {
    fields?: Record<string, string>;
    code?: string;
    message?: string;
  };
  return {
    code: source.fields?.code ?? source.code,
    constraint: source.fields?.constraint,
    detail: source.fields?.detail,
    message: source.fields?.message ?? source.message,
  };
}

/** Ошибки БД переводятся в понятные коды; текст драйвера наружу не уходит. */
export function fromDatabaseError(error: unknown): ApiError {
  const pgError = pgFields(error);
  const constraint = pgError.constraint ?? "";

  if (pgError.code === "23505") {
    if (constraint.includes("places_address_uniq")) {
      return new ApiError("duplicate", "Место с таким адресом уже есть в справочнике");
    }
    if (constraint.includes("slug")) {
      return new ApiError("duplicate", "Такой адрес уже занят");
    }
    return new ApiError("duplicate", "Такая запись уже существует");
  }
  if (pgError.code === "23503" && constraint.includes("type_id")) {
    return new ApiError("validation_failed", "Неизвестный тип записи");
  }
  if (pgError.code === "23514" && constraint.includes("slug_format")) {
    return new ApiError(
      "validation_failed",
      "Адрес может содержать только строчные латинские буквы, цифры и дефис",
    );
  }
  if (pgError.code === "23514" && constraint.includes("media_files")) {
    return new ApiError("validation_failed", "Недопустимое состояние файла", { constraint });
  }
  // Проверки значений параметров сообщают причину сами: в них уже сказано,
  // какого ответа ждёт параметр (Р-38).
  if (pgError.code === "23514" && pgError.message?.startsWith("Параметр")) {
    return new ApiError("validation_failed", pgError.message);
  }
  if (pgError.message?.includes("не имеет обоснования")) {
    return new ApiError(
      "link_requires_justification",
      "Связь нельзя сохранить без описания-обоснования",
    );
  }
  return new ApiError("internal_error", "Внутренняя ошибка сервиса");
}
