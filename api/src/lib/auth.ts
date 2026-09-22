/**
 * Вход и права.
 *
 * Токен выдаёт существующий Supabase Auth; API проверяет подпись и достаёт
 * идентификатор аккаунта. Аккаунт сопоставляется с участником (app.contributors).
 * Новый участник заводится при первом входе и НЕ получает никаких прав:
 * назначение ролей — отдельная административная операция (Р-04, Р-20).
 */
import { jwtVerify } from "jose";
import { sql, transaction } from "./db.ts";
import { config } from "./config.ts";
import { ApiError } from "./errors.ts";

export type Permission = "view" | "edit" | "create_delete" | "publish" | "review" | "su";

export interface Principal {
  authUid: string;
  contributorId: string;
  displayName: string;
  status: "active" | "disabled";
  permissions: Set<Permission>;
}

const secretKey = new TextEncoder().encode(config.auth.jwtSecret);

/** Гость: читает только опубликованное. */
export const ANONYMOUS: Principal | null = null;

export async function principalFromRequest(header: string | undefined): Promise<Principal | null> {
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();

  let authUid: string;
  try {
    const { payload } = await jwtVerify(token, secretKey);
    if (typeof payload.sub !== "string") {
      throw new ApiError("unauthenticated", "В токене нет идентификатора пользователя");
    }
    authUid = payload.sub;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("unauthenticated", "Токен недействителен или истёк");
  }

  const rows = await sql<{
    id: string; display_name: string; status: "active" | "disabled"; permissions: Permission[];
  }>`
    select c.id, c.display_name, c.status,
           coalesce(array_agg(p.action) filter (where p.action is not null), '{}') as permissions
    from app.contributors c
    left join app.user_roles ur on ur.contributor_id = c.id and ur.revoked_at is null
    left join app.role_permissions rp on rp.role_id = ur.role_id
    left join app.permissions p on p.id = rp.permission_id
    where c.auth_uid = ${authUid}
    group by c.id, c.display_name, c.status
  `;

  if (rows.length === 0) {
    const created = await transaction(null, (tx) =>
      tx<{ id: string; display_name: string; status: "active" | "disabled" }>`
        insert into app.contributors (auth_uid, display_name)
        values (${authUid}, ${"Участник " + authUid.slice(0, 8)})
        on conflict (auth_uid) do update set updated_at = now()
        returning id, display_name, status
      `);
    const contributor = created[0];
    return {
      authUid,
      contributorId: contributor.id,
      displayName: contributor.display_name,
      status: contributor.status,
      permissions: new Set(),
    };
  }

  const row = rows[0];
  if (row.status === "disabled") {
    throw new ApiError("permission_denied", "Учётная запись отключена");
  }
  return {
    authUid,
    contributorId: row.id,
    displayName: row.display_name,
    status: row.status,
    permissions: new Set((row.permissions as Permission[]).filter(Boolean)),
  };
}

export function can(principal: Principal | null, permission: Permission): boolean {
  if (!principal) return false;
  if (principal.permissions.has("su")) return true;
  return principal.permissions.has(permission);
}

export function require(principal: Principal | null, permission: Permission): Principal {
  if (!principal) {
    throw new ApiError("unauthenticated", "Нужен вход в систему");
  }
  if (!can(principal, permission)) {
    throw new ApiError("permission_denied", "Недостаточно прав для этого действия", {
      required: permission,
    });
  }
  return principal;
}

/** Видит ли пользователь неопубликованные материалы. */
export function canSeeDrafts(principal: Principal | null): boolean {
  return can(principal, "edit") || can(principal, "review") || can(principal, "su");
}
