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

/** Ошибки БД переводятся в понятные коды; текст драйвера наружу не уходит. */
export function fromDatabaseError(error: unknown): ApiError {
  const pgError = error as { code?: string; constraint_name?: string; message?: string };
  const constraint = pgError.constraint_name ?? "";

  if (pgError.code === "23505") {
    if (constraint.includes("slug")) {
      return new ApiError("duplicate", "Такой адрес уже занят в этом виде сущностей");
    }
    return new ApiError("duplicate", "Такая запись уже существует");
  }
  if (pgError.code === "23503" && constraint.includes("kind_id")) {
    return new ApiError("validation_failed", "Профиль не соответствует виду сущности");
  }
  if (pgError.code === "23514" && constraint.includes("slug_format")) {
    return new ApiError(
      "validation_failed",
      "Адрес может содержать только строчные латинские буквы, цифры и дефис",
    );
  }
  if (pgError.message?.includes("не имеет обоснования")) {
    return new ApiError(
      "link_requires_justification",
      "Связь нельзя сохранить без описания-обоснования",
    );
  }
  return new ApiError("internal_error", "Внутренняя ошибка сервиса");
}
