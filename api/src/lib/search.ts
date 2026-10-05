/**
 * Поисковый индекс (Р-109): куски записей и их векторы.
 *
 * Куски собираются из снимка версии — опубликованной и рабочей отдельно —
 * трёх видов: название, сведения, текст. Индексатор работает внутри API
 * фоном: раз в несколько секунд находит записи, у которых сдвинулся указатель
 * версии, пересобирает их куски и досчитывает векторы через Polza.AI.
 * Ни один маршрут правки об индексе не знает: сохранение и публикация не
 * замедляются и не падают из-за внешней модели.
 *
 * Без ключа POLZA_API_KEY индекс всё равно строится — поиск тогда только
 * полнотекстовый. Смена SEARCH_EMBED_MODEL пересчитывает все векторы.
 */
import { config } from "./config.ts";
import { sql } from "./db.ts";
import { log } from "./http.ts";
import { extractText } from "../routes/documents.ts";

export type ChunkKind = "title" | "params" | "text";

interface Chunk {
  kind: ChunkKind;
  chunk_no: number;
  block_id: string | null;
  content: string;
  hash: string;
}

interface Source {
  titles: (string | null)[];
  type_title: string | null;
  tags: string[];
  params: string | null;
  body: unknown;
}

/** Куска текста хватает на абзац-другой: точнее попадание, понятнее фрагмент. */
const TEXT_CHUNK_CHARS = 1800;

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function unique(list: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const value = item?.trim();
    if (value && !seen.has(value.toLowerCase())) {
      seen.add(value.toLowerCase());
      out.push(value);
    }
  }
  return out;
}

/** Текст режется по заголовкам и по длине; кусок помнит свой первый блок. */
function textPieces(body: unknown): { block_id: string | null; content: string }[] {
  const pieces: { block_id: string | null; content: string }[] = [];
  let current: string[] = [];
  let currentId: string | null = null;
  let length = 0;
  const flush = () => {
    const content = current.join("\n").trim();
    if (content) pieces.push({ block_id: currentId, content });
    current = [];
    currentId = null;
    length = 0;
  };
  for (const block of Array.isArray(body) ? body : []) {
    const node = block as { id?: string; type?: string };
    const text = extractText([block]);
    if (!text) continue;
    if (node.type === "heading" || length + text.length > TEXT_CHUNK_CHARS) flush();
    const blockId = typeof node.id === "string" ? node.id : null;
    // Очень длинный абзац режется по пробелам, чтобы кусок не разросся.
    if (text.length > TEXT_CHUNK_CHARS) {
      const parts = text.match(new RegExp(`[^]{1,${TEXT_CHUNK_CHARS}}(?=\\s|$)`, "g")) ?? [text];
      for (const part of parts) {
        pieces.push({ block_id: blockId, content: part.trim() });
      }
      continue;
    }
    if (current.length === 0) currentId = blockId;
    current.push(text);
    length += text.length + 1;
  }
  flush();
  return pieces;
}

/**
 * Куски записи. В модель уходит кусок вместе с названием записи — иначе абзац
 * «здесь зритель становится актёром» не знает, о каком здании он; хеш считается
 * от того, что ушло в модель.
 */
export async function buildChunks(source: Source): Promise<Chunk[]> {
  const titles = unique(source.titles);
  const name = titles[0] ?? "";
  const chunks: Chunk[] = [];
  const add = async (kind: ChunkKind, chunk_no: number, block_id: string | null, content: string) => {
    const embedInput = kind === "title" ? content : `${name}\n${content}`;
    chunks.push({ kind, chunk_no, block_id, content, hash: await sha256(`${kind}\n${embedInput}`) });
  };

  const title = unique([...titles, source.type_title, ...(source.tags ?? [])]).join("\n");
  if (title) await add("title", 0, null, title);

  const params = (source.params ?? "").trim();
  if (params) {
    // Сведений обычно немного; длинный список (место, изображение) — частями.
    const lines = params.split("\n");
    let part: string[] = [];
    let no = 0;
    for (const line of lines) {
      if (part.join("\n").length + line.length > TEXT_CHUNK_CHARS && part.length) {
        await add("params", no++, null, part.join("\n"));
        part = [];
      }
      part.push(line);
    }
    if (part.length) await add("params", no, null, part.join("\n"));
  }

  let no = 0;
  for (const piece of textPieces(source.body)) await add("text", no++, piece.block_id, piece.content);
  return chunks;
}

/** Текст, который уходит в модель для куска (тот же, что в хеше). */
function embedInputFor(kind: string, content: string, name: string): string {
  return kind === "title" ? content : `${name}\n${content}`;
}

// ── Эмбеддинги ──────────────────────────────────────────────────────────────

export function embeddingsEnabled(): boolean {
  return config.search.apiKey !== null;
}

/** Векторы для списка текстов; порядок ответа — по index. */
async function embed(inputs: string[]): Promise<number[][]> {
  const response = await fetch(`${config.search.baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.search.apiKey}`,
    },
    body: JSON.stringify({
      model: config.search.model,
      input: inputs,
      dimensions: config.search.dimensions,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`Модель эмбеддингов ответила ${response.status}: ${detail}`);
  }
  const data = await response.json() as {
    data: { index: number; embedding: number[] }[];
    usage?: { total_tokens?: number };
  };
  stats.tokens += data.usage?.total_tokens ?? 0;
  const vectors = [...data.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
  for (const v of vectors) {
    if (v.length !== config.search.dimensions) {
      throw new Error(`Модель вернула вектор длины ${v.length}, ждали ${config.search.dimensions}`);
    }
  }
  return vectors;
}

/** Последние запросы читателей повторяются: вектор запроса держим в памяти. */
const queryCache = new Map<string, number[]>();

/** Вектор запроса; null — модель недоступна, поиск идёт только по словам. */
export async function embedQuery(query: string, requestId: string): Promise<number[] | null> {
  if (!embeddingsEnabled()) return null;
  const key = query.trim().toLowerCase();
  const cached = queryCache.get(key);
  if (cached) return cached;
  try {
    const [vector] = await embed([query.trim()]);
    queryCache.set(key, vector);
    if (queryCache.size > 500) queryCache.delete(queryCache.keys().next().value!);
    return vector;
  } catch (error) {
    log("warn", requestId, "Вектор запроса не получен — поиск только по словам", {
      error: String(error),
    });
    return null;
  }
}

// ── Индексатор ──────────────────────────────────────────────────────────────

export const stats = {
  started_at: null as string | null,
  last_run_at: null as string | null,
  last_error: null as string | null,
  last_error_at: null as string | null,
  rebuilt_entities: 0,
  embedded_chunks: 0,
  tokens: 0,
};

let running = false;

/** Пересобрать куски одной записи в одной области (опубликованное / рабочее). */
async function rebuild(row: { entity_id: string; scope: string; revision_id: string }): Promise<void> {
  const [{ source }] = await sql<{ source: Source | null }>`
    select app.search_revision_source(${row.revision_id}::uuid) as source`;
  if (!source) return;
  const chunks = await buildChunks(source);
  await sql`select app.search_put(${row.entity_id}::bigint, ${row.scope}, ${row.revision_id}::uuid,
                                  ${JSON.stringify(chunks)}::jsonb)`;
  stats.rebuilt_entities++;
}

/** Полная пересборка (POST /search/reindex); векторы прежнего текста сохраняются. */
export async function rebuildAll(requestId: string): Promise<void> {
  try {
    const rows = await sql<{ entity_id: string; scope: string; revision_id: string }>`
      select id as entity_id, 'published' as scope, published_revision_id as revision_id
        from app.entities where status = 'published' and published_revision_id is not null
      union all
      select id, 'working', working_revision_id
        from app.entities where status <> 'archived' and working_revision_id is not null`;
    for (const row of rows) await rebuild(row);
    log("info", requestId, "Индекс поиска пересобран", { rows: rows.length });
    await indexOnce();
  } catch (error) {
    stats.last_error = String(error);
    stats.last_error_at = new Date().toISOString();
    log("error", requestId, "Сбой пересборки индекса поиска", { error: String(error) });
  }
}

/** Один проход: убрать снятое, пересобрать сдвинувшееся, досчитать векторы. */
export async function indexOnce(budget = { entities: 50, batches: 10 }): Promise<void> {
  if (running) return;
  running = true;
  const requestId = `search-indexer-${crypto.randomUUID().slice(0, 8)}`;
  try {
    await sql`select app.search_prune()`;

    const stale = await sql<{ entity_id: string; scope: string; revision_id: string }>`
      select entity_id, scope, revision_id from app.search_stale(${budget.entities})`;
    for (const row of stale) await rebuild(row);

    if (embeddingsEnabled()) {
      for (let batch = 0; batch < budget.batches; batch++) {
        const pending = await sql<{ content_sha256: string; kind: string; content: string; name: string }>`
          select distinct on (c.content_sha256) c.content_sha256, c.kind, c.content,
                 coalesce(t.content, '') as name
            from app.search_pending(${config.search.model}, ${config.search.batchSize * 4}) p
            join app.search_chunks c on c.id = p.id
            left join app.search_chunks t on t.entity_id = c.entity_id and t.scope = c.scope
                 and t.kind = 'title' and t.chunk_no = 0
           order by c.content_sha256
           limit ${config.search.batchSize}`;
        if (pending.length === 0) break;
        const inputs = pending.map((p) =>
          embedInputFor(p.kind, p.content, p.name.split("\n")[0] ?? "").slice(0, 8000)
        );
        const vectors = await embed(inputs);
        const items = pending.map((p, i) => ({
          hash: p.content_sha256,
          embedding: `[${vectors[i].join(",")}]`,
        }));
        await sql`select app.search_set_embeddings(${config.search.model}, ${JSON.stringify(items)}::jsonb)`;
        stats.embedded_chunks += pending.length;
      }
    }
    stats.last_run_at = new Date().toISOString();
  } catch (error) {
    stats.last_error = String(error);
    stats.last_error_at = new Date().toISOString();
    log("error", requestId, "Сбой индексатора поиска", { error: String(error) });
  } finally {
    running = false;
  }
}

/** Фоновый индексатор API; первый проход — сразу после запуска. */
export function startSearchIndexer(): void {
  stats.started_at = new Date().toISOString();
  log("info", "search-indexer", "Индексатор поиска запущен", {
    model: config.search.model,
    embeddings: embeddingsEnabled(),
    interval_ms: config.search.intervalMs,
  });
  setTimeout(() => indexOnce(), 5_000);
  setInterval(() => indexOnce(), config.search.intervalMs);
}
