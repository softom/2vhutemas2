/**
 * Сериализация больших целых.
 *
 * PostgreSQL возвращает bigint как BigInt, а JSON.stringify такие значения
 * не умеет. Переводим в число, пока оно помещается без потери точности,
 * иначе — в строку: молчаливое округление идентификатора недопустимо.
 */
declare global {
  interface BigInt {
    toJSON(): number | string;
  }
}

BigInt.prototype.toJSON = function (): number | string {
  const value = this.valueOf();
  return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)
    ? Number(value)
    : value.toString();
};

export {};
