/**
 * Подключение к PostgreSQL.
 *
 * API ходит в БД напрямую (решение Р-02): обязательные атомарные операции —
 * связь вместе с обоснованием, версия вместе с материалом, публикация вместе
 * с переводом указателя — через PostgREST невыразимы.
 *
 * Работает от роли app_api: писать может только в схему app, структуру менять
 * не может, ведомость студентов ей недоступна.
 *
 * Драйвер — родной для Deno (@db/postgres). Слой совместимости с Node не
 * подходит: его разрешение имён не видит имена контейнеров Docker, проверено
 * на сервере 2026-09-22.
 */
import { Pool, type PoolClient, type Transaction } from "@db/postgres";
import { config } from "./config.ts";

const pool = new Pool({
  hostname: config.db.host,
  port: config.db.port,
  database: config.db.database,
  user: config.db.user,
  password: config.db.password,
  tls: { enabled: false },
}, config.db.maxConnections, true);

/** Запрос в виде шаблонной строки: значения подставляются параметрами, не текстом. */
export type Query = <T = Record<string, unknown>>(
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<T[]>;

function queryWith(runner: { queryObject: (q: { text: string; args: unknown[] }) => Promise<{ rows: unknown[] }> }): Query {
  return async <T>(strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = strings[0];
    for (let i = 0; i < values.length; i++) {
      text += `$${i + 1}` + strings[i + 1];
    }
    const result = await runner.queryObject({ text, args: values });
    return result.rows as T[];
  };
}

/** Запрос вне транзакции: соединение берётся из пула и сразу возвращается. */
export const sql: Query = async <T>(strings: TemplateStringsArray, ...values: unknown[]) => {
  const client = await pool.connect();
  try {
    return await queryWith(client)<T>(strings, ...values);
  } finally {
    client.release();
  }
};

export type Tx = Query;

/**
 * Транзакция от имени участника: его идентификатор кладётся в app.contributor_id,
 * откуда его берут триггеры аудита. Автор действия определяется сервером,
 * а не приходит из формы.
 */
export async function transaction<T>(
  contributorId: string | null,
  body: (tx: Tx) => Promise<T>,
): Promise<T> {
  const client: PoolClient = await pool.connect();
  const name = `tx_${crypto.randomUUID().replaceAll("-", "")}`;
  const tx: Transaction = client.createTransaction(name);
  try {
    await tx.begin();
    const run = queryWith(tx);
    await run`select set_config('app.contributor_id', ${contributorId ?? ""}, true)`;
    const result = await body(run);
    await tx.commit();
    return result;
  } catch (error) {
    try {
      await tx.rollback();
    } catch { /* откат уже выполнен сервером — исходная ошибка важнее */ }
    throw error;
  } finally {
    client.release();
  }
}

export async function healthCheck(): Promise<{ ok: boolean; latencyMs: number }> {
  const started = performance.now();
  await sql`select 1`;
  return { ok: true, latencyMs: Math.round(performance.now() - started) };
}

export async function closePool(): Promise<void> {
  await pool.end();
}
