import { Hono } from "hono";
import { require as requirePermission } from "../lib/auth.ts";
import { sql } from "../lib/db.ts";
import { ApiError } from "../lib/errors.ts";
import type { AppEnv } from "../lib/http.ts";

export async function tokenDigest(token:string){
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
}

export const intakeTokens = new Hono<AppEnv>();
intakeTokens.use("*",async (c,next)=>{
  requirePermission(c.get("principal"),"su");
  c.header("Cache-Control","no-store");
  await next();
});
intakeTokens.get("/",async c=>c.json(await sql`select id,system_name,expires_at from app.intake_tokens
  where expires_at>now() order by expires_at,id`));
intakeTokens.post("/",async c=>{
  const body=await c.req.json().catch(()=>null);
  if(typeof body?.name!=="string" || !body.name.trim() || body.name.length>120 || ![1,7,30,90].includes(body.days))
    throw new ApiError("validation_failed","Укажите название системы и срок действия");
  const bytes=crypto.getRandomValues(new Uint8Array(32));
  const token="intake_"+Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");
  const [row]=await sql`insert into app.intake_tokens(system_name,digest,issued_by,expires_at)
    values(${body.name.trim()},${await tokenDigest(token)},
    ${c.get("principal")!.contributorId},now()+${body.days}::int * interval '24 hours')
    returning id,system_name,expires_at`;
  return c.json({...row,token},201);
});
