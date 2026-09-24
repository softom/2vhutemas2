/**
 * Места: справочник положений на карте и их привязка к сущностям.
 *
 * Решение Р-25: смысл привязки задаёт её роль, а не сама запись места.
 * Одно место — адрес здания, место рождения человека, захоронение, офис бюро.
 * Пустая запись не создаётся: нет сведений — нет ни места, ни привязки.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { sql, transaction, type Tx } from "../lib/db.ts";
import { ApiError } from "../lib/errors.ts";
import { require as requirePermission } from "../lib/auth.ts";
import { type AppEnv, pageSize } from "../lib/http.ts";

export const places = new Hono<AppEnv>();

const PRECISIONS = ["point", "building", "settlement", "region"];

interface PlaceInput {
  country?: string | null;
  settlement?: string | null;
  street?: string | null;
  house?: string | null;
  unit?: string | null;
  lat?: number | null;
  lon?: number | null;
  precision?: string;
  source_url?: string | null;
}

/** Лишние пробелы в адрес не попадают: «дом 36 » и «дом 36» — одно и то же. */
function trimmed(input: PlaceInput): PlaceInput {
  const clean = (value: string | null | undefined) => {
    const text = typeof value === "string" ? value.trim() : value;
    return text === "" ? null : text ?? null;
  };
  return {
    ...input,
    country: clean(input.country),
    settlement: clean(input.settlement),
    street: clean(input.street),
    house: clean(input.house),
    unit: clean(input.unit),
    source_url: clean(input.source_url),
  };
}

function validate(input: PlaceInput): void {
  const problems: Record<string, string> = {};
  const parts = [input.country, input.settlement, input.street, input.house, input.unit];
  const hasAddress = parts.some((part) => part && part.trim() !== "");
  const hasCoords = input.lat !== null && input.lat !== undefined;
  // Пустая запись не создаётся: нет сведений — нет места (решение Р-25).
  if (!hasAddress && !hasCoords) {
    problems.country = "Укажите хотя бы часть адреса или координаты";
  }
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

/**
 * Уже заведённое место с таким же адресом. Сравнение без учёта регистра
 * и лишних пробелов: «Красный проспект» и «красный  проспект » — одно место.
 */
async function findSame(tx: Tx, input: PlaceInput): Promise<string | null> {
  const parts = [input.country, input.settlement, input.street, input.house, input.unit];
  if (!parts.some((part) => part && part.trim() !== "")) return null;

  const rows = await tx<{ id: string }>`
    select id from app.places
     where lower(btrim(coalesce(country, ''))) = lower(btrim(coalesce(${input.country ?? null}, '')))
       and lower(btrim(coalesce(settlement, ''))) = lower(btrim(coalesce(${input.settlement ?? null}, '')))
       and lower(btrim(coalesce(street, ''))) = lower(btrim(coalesce(${input.street ?? null}, '')))
       and lower(btrim(coalesce(house, ''))) = lower(btrim(coalesce(${input.house ?? null}, '')))
       and lower(btrim(coalesce(unit, ''))) = lower(btrim(coalesce(${input.unit ?? null}, '')))
     limit 1
  `;
  return rows.length > 0 ? rows[0].id : null;
}

/**
 * Создание места с оглядкой на справочник: совпадающий адрес не заводится
 * заново, а переиспользуется. Координаты дописываются, если их не было.
 */
async function createOrReuse(tx: Tx, raw: PlaceInput): Promise<{ id: string; reused: boolean }> {
  const input = trimmed(raw);
  const existing = await findSame(tx, input);
  if (existing) {
    if (input.lat !== null && input.lat !== undefined) {
      await tx`
        update app.places
           set lon = coalesce(lon, ${input.lon ?? null}),
               precision = case when lat is null then ${input.precision ?? "settlement"}
                                else precision end,
               lat = coalesce(lat, ${input.lat})
         where id = ${existing}
      `;
    }
    return { id: existing, reused: true };
  }

  const created = await tx<{ id: string }>`
    insert into app.places (country, settlement, street, house, unit, lat, lon,
                            precision, source_url)
    values (${input.country ?? null}, ${input.settlement ?? null}, ${input.street ?? null},
            ${input.house ?? null}, ${input.unit ?? null},
            ${input.lat ?? null}, ${input.lon ?? null},
            ${input.precision ?? "settlement"}, ${input.source_url ?? null})
    returning id
  `;
  return { id: created[0].id, reused: false };
}

/**
 * Поиск по справочнику: место переиспользуется, а не заводится заново.
 * Справочник — рабочий инструмент редактора, гостю он не нужен: места
 * опубликованных объектов видны в их карточках.
 */
places.get("/", async (c: Context<AppEnv>) => {
  requirePermission(c.get("principal"), "edit");
  const limit = pageSize(c.req.query("limit"));
  const search = c.req.query("q")?.trim() || null;
  const pattern = search ? `%${search}%` : null;

  const rows = await sql<Record<string, unknown>>`
    select id, country, settlement, street, house, unit, lat, lon, precision, source_url
    from app.places
    where ${pattern}::text is null
       or settlement ilike ${pattern} or country ilike ${pattern}
       or street ilike ${pattern} or house ilike ${pattern}
    order by country nulls last, settlement nulls last, street nulls last, house nulls last
    limit ${limit}
  `;
  return c.json({ items: rows });
});

/** Где место используется: правка меняет сведения во всех этих карточках. */
places.get("/:id/usage", async (c: Context<AppEnv>) => {
  requirePermission(c.get("principal"), "edit");
  const rows = await sql<Record<string, unknown>>`
    select e.id, e.title_ru, p.title_ru as role_title
    from app.indicator_values iv
    join app.indicators i on i.id = iv.indicator_id
    join app.entities e on e.id = i.entity_id
    join app.parameters p on p.id = iv.parameter_id
    where iv.place_id = ${c.req.param("id")}
    order by e.title_ru
  `;
  return c.json({ items: rows });
});

places.post("/", async (c: Context<AppEnv>) => {
  const principal = requirePermission(c.get("principal"), "create_delete");
  const input = await c.req.json<PlaceInput>();
  validate(input);

  const result = await transaction(principal.contributorId, (tx) => createOrReuse(tx, input));
  return c.json(result, result.reused ? 200 : 201);
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
        country    = coalesce(${trimmed(input).country}, country),
        settlement = coalesce(${trimmed(input).settlement}, settlement),
        street     = coalesce(${trimmed(input).street}, street),
        house      = coalesce(${trimmed(input).house}, house),
        unit       = coalesce(${trimmed(input).unit}, unit),
        lat        = coalesce(${input.lat ?? null}, lat),
        lon        = coalesce(${input.lon ?? null}, lon),
        precision  = coalesce(${input.precision ?? null}, precision),
        source_url = coalesce(${input.source_url ?? null}, source_url)
      where id = ${placeId}
      returning id
    `);
  if (updated.length === 0) throw new ApiError("not_found", "Место не найдено");
  return c.json({ id: placeId });
});

