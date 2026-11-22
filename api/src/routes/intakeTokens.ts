import { Hono } from "hono";
import { require as requirePermission } from "../lib/auth.ts";
import { sql } from "../lib/db.ts";
import { ApiError } from "../lib/errors.ts";
import type { AppEnv } from "../lib/http.ts";

export async function tokenDigest(token:string){
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
}

export type TokenScope = "intake" | "edit_cards";

export async function readActiveToken(credential:string) {
  if (!/^Bearer intake_[0-9a-f]{64}$/.test(credential))
    throw new ApiError("unauthenticated","Нужен токен доступа");
  const [row]=await sql<{id:string; issued_by:string; auth_uid:string; system_name:string; scopes:TokenScope[]; expires_at:Date}>`select t.id,t.issued_by,c.auth_uid,t.system_name,t.scopes,t.expires_at
    from app.intake_tokens t join app.contributors c on c.id=t.issued_by and c.status='active'
    where digest=${await tokenDigest(credential.slice(7))} and expires_at>now()`;
  if (!row) throw new ApiError("unauthenticated","Токен недействителен или истёк");
  return row;
}

export async function authorizeToken(credential:string, scope:TokenScope) {
  const row=await readActiveToken(credential);
  if (!row.scopes.includes(scope)) throw new ApiError("permission_denied","Токену не выдано это право");
  return row;
}

export const intakeTokens = new Hono<AppEnv>();
intakeTokens.use("*",async (c,next)=>{
  requirePermission(c.get("principal"),"su");
  c.header("Cache-Control","no-store");
  await next();
});
intakeTokens.get("/",async c=>c.json(await sql`select id,system_name,expires_at,scopes from app.intake_tokens
  where expires_at>now() order by expires_at,id`));
intakeTokens.post("/",async c=>{
  const body=await c.req.json().catch(()=>null);
  if(typeof body?.name!=="string" || !body.name.trim() || body.name.length>120 || ![1,7,30,90].includes(body.days))
    throw new ApiError("validation_failed","Укажите название системы и срок действия");
  const scopes:unknown = body.scopes === undefined ? ["intake"] : body.scopes;
  if (!Array.isArray(scopes) || !scopes.length || scopes.length>2 ||
      scopes.some(s=>s!=="intake" && s!=="edit_cards") || new Set(scopes).size!==scopes.length)
    throw new ApiError("validation_failed","Выберите права токена");
  const bytes=crypto.getRandomValues(new Uint8Array(32));
  const token="intake_"+Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");
  const [row]=await sql`insert into app.intake_tokens(system_name,digest,issued_by,expires_at,scopes)
    values(${body.name.trim()},${await tokenDigest(token)},
    ${c.get("principal")!.contributorId},now()+${body.days}::int * interval '24 hours',${scopes}::text[])
    returning id,system_name,expires_at,scopes`;
  return c.json({...row,token},201);
});
