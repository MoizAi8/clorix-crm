import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { db } from "@/server/db";
import { appOrigin, AppError } from "@/server/http";

export function quotaHash(scope:string,identity:string) {
  const secret=process.env.DEMO_RATE_LIMIT_SECRET;
  if (!secret || secret.length<32) throw new Error("Quota service unavailable.");
  return createHmac("sha256",secret).update(scope+"\0"+identity).digest("hex");
}

export function requestNetwork(request:Request) {
  const network=request.headers.get("x-vercel-forwarded-for")?.trim();
  const hosted=process.env.VERCEL==="1";
  if (hosted && (!network || !isIP(network))) throw new AppError(503,"network","Request verification is temporarily unavailable.");
  if (!hosted && !["localhost","127.0.0.1"].includes(new URL(appOrigin()).hostname)) {
    throw new AppError(503,"network","Request verification is unavailable outside the configured platform.");
  }
  return hosted ? network! : "local";
}

export async function quota(request:Request,scope:string,limit:number,seconds:number,identity?:string) {
  const network=requestNetwork(request);
  const hash=quotaHash(scope,identity??network);
  const {rows} = await db().query("SELECT clorix_access.consume_quota($1,$2,$3) AS allowed",[hash,limit,seconds]);
  if (!rows[0]?.allowed) throw new AppError(429,"quota","Too many requests. Please try again later.",seconds);
}
