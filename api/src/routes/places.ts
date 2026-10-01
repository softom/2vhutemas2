/**
 * Места — записи типа «Место» (Р-85).
 *
 * Место такая же запись, как человек или здание: свой тип, сведения —
 * параметры набора «Место — сведения», своя страница и версии. Здесь — удобный
 * вход редактора адреса: найти место, завести новое, поправить, узнать, где
 * оно используется. Номер места — номер записи.
 *
 * Отношение к месту — параметр той записи, что на него ссылается: «Адрес
 * объекта», «Место рождения». Причина — пояснение к значению.
 * Пустое место не заводится: нет сведений — нет ни места, ни ссылки (Р-25).
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { sql, transaction, type Tx } from "../lib/db.ts";
import { ApiError } from "../lib/errors.ts";
import { require as requirePermission } from "../lib/auth.ts";
import { type AppEnv, pageSize } from "../lib/http.ts";
import { createRecord, type ParamAnswer, saveRevision, setAnswers, setPublished } from "../lib/records.ts";

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

/** Название места собирается из адреса: так его видно в списках и в тексте. */
function title(input: PlaceInput): string {
  const line = [input.street, input.house].filter(Boolean).join(" ");
  const label = [input.settlement, line, input.unit].filter(Boolean).join(", ");
  if (label) return label;
  if (input.country) return input.country;
  return input.lat !== null && input.lat !== undefined ? `${input.lat}, ${input.lon}` : "Место";
}

/** Ответы набора «Место — сведения»; непереданное поле остаётся как было. */
function answers(input: PlaceInput, partial: boolean): ParamAnswer[] {
  const out: ParamAnswer[] = [];
  const put = (key: keyof PlaceInput, answer: ParamAnswer) => {
    if (!partial || input[key] !== undefined) out.push(answer);
  };
  put("country", { code: "country", text: input.country });
  put("settlement", { code: "settlement", text: input.settlement });
  put("street", { code: "street", text: input.street });
  put("house", { code: "house", text: input.house });
  put("unit", { code: "unit", text: input.unit });
  put("lat", { code: "latitude", num: input.lat ?? null });
  put("lon", { code: "longitude", num: input.lon ?? null });
  put("precision", { code: "coord_precision", option: input.precision ?? (partial ? null : "settlement") });
  put("source_url", { code: "info_source_url", text: input.source_url });
  return out;
}

/** Место одним объектом — в том виде, что знает редактор адреса. */
async function view(tx: Tx, id: number) {
  const rows = await tx<{ place: Record<string, unknown> }>`select app.place_json(${id}, true) as place`;
  return rows[0]?.place ?? null;
}

/**
 * Уже заведённое место с таким же адресом. Сравнение без учёта регистра
 * и лишних пробелов: «Красный проспект» и «красный  проспект » — одно место.
 */
async function findSame(tx: Tx, input: PlaceInput): Promise<number | null> {
  const parts = [input.country, input.settlement, input.street, input.house, input.unit];
  if (!parts.some((part) => part && part.trim() !== "")) return null;
  const norm = (value: string | null | undefined) => (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const rows = await tx<{ id: number; place: Record<string, string | null> }>`
    select e.id, app.place_json(e.id, true) as place
      from app.entities e join app.entity_types t on t.id = e.type_id
     where t.code = 'place' and e.status <> 'archived'
  `;
  const keys = ["country", "settlement", "street", "house", "unit"] as const;
  const found = rows.find((row) => keys.every((key) => norm(row.place[key]) === norm(input[key])));
  return found ? Number(found.id) : null;
}

/**
 * Поиск мест: место переиспользуется, а не заводится заново. Это рабочий
 * инструмент редактора; гостю места видны в карточках записей и на своих
 * страницах.
 */
places.get("/", async (c: Context<AppEnv>) => {
  requirePermission(c.get("principal"), "edit");
  const limit = pageSize(c.req.query("limit"));
  const search = c.req.query("q")?.trim() || null;
  const pattern = search ? `%${search}%` : null;

  const rows = await sql<{ place: Record<string, unknown> }>`
    select app.place_json(e.id, true) as place
      from app.entities e join app.entity_types t on t.id = e.type_id
     where t.code = 'place' and e.status <> 'archived'
       and (${pattern}::text is null or e.title_ru ilike ${pattern}
            or app.place_json(e.id, true)::text ilike ${pattern})
     order by e.title_ru
     limit ${limit}
  `;
  return c.json({ items: rows.map((row) => row.place) });
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
    where iv.entity_value_id = ${Number(c.req.param("id"))}
    order by e.title_ru
  `;
  return c.json({ items: rows });
});

/**
 * Новое место — новая запись. Совпадающий адрес не заводится заново, а
 * переиспользуется; координаты дописываются, если их не было. Место
 * публикуется сразу: адрес опубликованного объекта и раньше был виден всем.
 */
places.post("/", async (c: Context<AppEnv>) => {
  const principal = requirePermission(c.get("principal"), "create_delete");
  const input = trimmed(await c.req.json<PlaceInput>());
  validate(input);

  const result = await transaction(principal.contributorId, async (tx) => {
    const existing = await findSame(tx, input);
    if (existing) {
      const current = await view(tx, existing);
      if (input.lat !== null && input.lat !== undefined && current && current.lat === null) {
        await setAnswers(tx, existing, answers(
          { lat: input.lat, lon: input.lon, precision: input.precision ?? "settlement" }, true));
        await saveRevision(tx, existing, principal.contributorId, "Координаты места");
        await setPublished(tx, existing, true);
      }
      return { id: String(existing), reused: true };
    }
    const created = await createRecord(tx, {
      type: "place", title: title(input), contributorId: principal.contributorId,
    });
    await setAnswers(tx, created.id, answers(input, false));
    await saveRevision(tx, created.id, principal.contributorId, "Создание места", "create");
    await setPublished(tx, created.id, true);
    return { id: String(created.id), reused: false };
  });
  return c.json(result, result.reused ? 200 : 201);
});

places.patch("/:id", async (c: Context<AppEnv>) => {
  const principal = requirePermission(c.get("principal"), "edit");
  const placeId = Number(c.req.param("id"));
  const input = trimmed(await c.req.json<PlaceInput>());
  if (input.precision && !PRECISIONS.includes(input.precision)) {
    throw new ApiError("validation_failed", "Неизвестный уровень точности");
  }

  await transaction(principal.contributorId, async (tx) => {
    const found = await tx<{ id: number; status: string }>`
      select e.id, e.status from app.entities e join app.entity_types t on t.id = e.type_id
       where e.id = ${placeId} and t.code = 'place'
    `;
    if (found.length === 0) throw new ApiError("not_found", "Место не найдено");
    // Пустое поле правки — «не менять», как и раньше: стирать адрес правкой
    // одного поля нельзя.
    const keep = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== null && v !== undefined));
    await setAnswers(tx, placeId, answers(keep as PlaceInput, true));
    const place = await view(tx, placeId);
    if (place) {
      await tx`update app.entities set title_ru = ${title(place as PlaceInput)} where id = ${placeId}`;
    }
    await saveRevision(tx, placeId, principal.contributorId, "Правка места");
    if (found[0].status === "published") await setPublished(tx, placeId, true);
  });
  return c.json({ id: String(placeId) });
});
