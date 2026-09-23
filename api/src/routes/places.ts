/**
 * Места: справочник положений на карте и их привязка к сущностям.
 *
 * Решение Р-25: смысл привязки задаёт её роль, а не сама запись места.
 * Одно место — адрес здания, место рождения человека, захоронение, офис бюро.
 * Пустая запись не создаётся: нет сведений — нет ни места, ни привязки.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { sql, transaction } from "../lib/db.ts";
import { ApiError } from "../lib/errors.ts";
import { require as requirePermission } from "../lib/auth.ts";
import { type AppEnv, pageSize } from "../lib/http.ts";

export const places = new Hono<AppEnv>();

const PRECISIONS = ["point", "building", "settlement", "region"];

interface PlaceInput {
  title?: string;
  address_line?: string | null;
  settlement?: string | null;
  country?: string | null;
  lat?: number | null;
  lon?: number | null;
  precision?: string;
  source_url?: string | null;
}

function validate(input: PlaceInput): void {
  const problems: Record<string, string> = {};
  if (!input.title?.trim()) problems.title = "Не указано название места";
  if (input.precision && !PRECISIONS.includes(input.precision)) {
    problems.precision = "Неизвестный уровень точности";
  }
  const hasLat = input.lat !== null && input.lat !== undefined;
  const hasLon = input.lon !== null && input.lon !== undefined;
  if (hasLat !== hasLon) {
    problems.lat = "Координаты указываются парой: широта и долгота";
  }
  if (Object.keys(problems).length > 0) {
    throw new ApiError("validation_failed", "Проверьте заполнение полей", problems);
  }
}

/** Поиск по справочнику: место переиспользуется, а не заводится заново. */
places.get("/", async (c: Context<AppEnv>) => {
  const limit = pageSize(c.req.query("limit"));
  const search = c.req.query("q")?.trim() || null;
  const pattern = search ? `%${search}%` : null;

  const rows = await sql<Record<string, unknown>>`
    select id, title, address_line, settlement, country, lat, lon, precision, source_url
    from app.places
    where ${pattern}::text is null
       or title ilike ${pattern} or address_line ilike ${pattern}
       or settlement ilike ${pattern} or country ilike ${pattern}
    order by title
    limit ${limit}
  `;
  return c.json({ items: rows });
});

places.post("/", async (c: Context<AppEnv>) => {
  const principal = requirePermission(c.get("principal"), "create_delete");
  const input = await c.req.json<PlaceInput>();
  validate(input);

  const created = await transaction(principal.contributorId, (tx) =>
    tx<{ id: string }>`
      insert into app.places (title, address_line, settlement, country, lat, lon,
                              precision, source_url)
      values (${input.title!.trim()}, ${input.address_line ?? null},
              ${input.settlement ?? null}, ${input.country ?? null},
              ${input.lat ?? null}, ${input.lon ?? null},
              ${input.precision ?? "settlement"}, ${input.source_url ?? null})
      returning id
    `);

  return c.json({ id: created[0].id }, 201);
});

places.patch("/:id", async (c: Context<AppEnv>) => {
  const principal = requirePermission(c.get("principal"), "edit");
  const placeId = c.req.param("id");
  const input = await c.req.json<PlaceInput>();
  if (input.precision && !PRECISIONS.includes(input.precision)) {
    throw new ApiError("validation_failed", "Неизвестный уровень точности");
  }

  const updated = await transaction(principal.contributorId, (tx) =>
    tx<{ id: string }>`
      update app.places set
        title        = coalesce(${input.title ?? null}, title),
        address_line = coalesce(${input.address_line ?? null}, address_line),
        settlement   = coalesce(${input.settlement ?? null}, settlement),
        country      = coalesce(${input.country ?? null}, country),
        lat          = coalesce(${input.lat ?? null}, lat),
        lon          = coalesce(${input.lon ?? null}, lon),
        precision    = coalesce(${input.precision ?? null}, precision),
        source_url   = coalesce(${input.source_url ?? null}, source_url)
      where id = ${placeId}
      returning id
    `);
  if (updated.length === 0) throw new ApiError("not_found", "Место не найдено");
  return c.json({ id: placeId });
});

/**
 * Привязка места к сущности с ролью. Можно передать существующее место
 * по идентификатору либо описать новое — тогда оно создаётся в той же
 * транзакции. Обоснование здесь не требуется: правило обязательного
 * обоснования относится к содержательным связям культурных сущностей.
 */
places.post("/attachments", async (c: Context<AppEnv>) => {
  const principal = requirePermission(c.get("principal"), "edit");
  const input = await c.req.json<{
    entity_id: number;
    role: string;
    place_id?: string;
    place?: PlaceInput;
    note?: string | null;
  }>();

  if (!Number.isInteger(input.entity_id)) {
    throw new ApiError("validation_failed", "Не указана сущность");
  }
  if (!input.role) throw new ApiError("validation_failed", "Не указана роль места");
  if (!input.place_id && !input.place) {
    throw new ApiError("validation_failed", "Выберите место или опишите новое");
  }
  if (input.place) validate(input.place);

  const result = await transaction(principal.contributorId, async (tx) => {
    let placeId = input.place_id ?? null;
    if (!placeId) {
      const place = input.place!;
      const created = await tx<{ id: string }>`
        insert into app.places (title, address_line, settlement, country, lat, lon,
                                precision, source_url)
        values (${place.title!.trim()}, ${place.address_line ?? null},
                ${place.settlement ?? null}, ${place.country ?? null},
                ${place.lat ?? null}, ${place.lon ?? null},
                ${place.precision ?? "settlement"}, ${place.source_url ?? null})
        returning id
      `;
      placeId = created[0].id;
    }

    const targets = await tx<{ id: number }>`
      select id from app.targets where entity_id = ${input.entity_id}
    `;
    if (targets.length === 0) throw new ApiError("not_found", "Сущность не найдена");

    const attached = await tx<{ id: number }>`
      insert into app.attachments (target_id, role_id, place_id, note)
      values (${targets[0].id},
              (select id from app.attachment_roles where code = ${input.role}),
              ${placeId}, ${input.note ?? null})
      on conflict do nothing
      returning id
    `;
    if (attached.length === 0) {
      throw new ApiError("duplicate", "Это место уже привязано к сущности с такой ролью");
    }
    return { attachment_id: Number(attached[0].id), place_id: placeId };
  });

  return c.json(result, 201);
});

places.delete("/attachments/:id", async (c: Context<AppEnv>) => {
  requirePermission(c.get("principal"), "edit");
  const attachmentId = Number(c.req.param("id"));
  const removed = await sql`
    delete from app.attachments where id = ${attachmentId} and place_id is not null returning id
  `;
  if (removed.length === 0) throw new ApiError("not_found", "Привязка не найдена");
  return c.body(null, 204);
});
