import type { PoolClient } from "pg";
import { z } from "zod";
import { identity } from "@/server/auth";
import { transaction } from "@/server/db";
import { AppError } from "@/server/http";

export type Workspace = {
  id:string; name:string; currency:string; timezone:string; kind:"private"|"sandbox";
  expires_at:string|null; role:"owner"|"member"; member_id:string; version:number;
};

export type Context = { client:PoolClient; workspace:Workspace; user:{id:string;name:string;email:string} };

export async function actorContext<T>(headers: Headers, fn:(client:PoolClient,user:Context["user"])=>Promise<T>,readOnly=false) {
  const session = await identity(headers);
  if (!session) throw new AppError(401,"login","Sign in or start a sandbox to continue.");
  return transaction(async client => {
    await client.query("SELECT set_config('clorix.actor',$1,true)",[session.user.id]);
    return fn(client,session.user);
  },readOnly);
}

const membershipSql = `SELECT w.id,w.name,w.currency,w.timezone,w.kind,w.expires_at,w.version,m.role,m.id AS member_id
 FROM workspaces w JOIN memberships m ON m.workspace_id=w.id
 WHERE m.user_id=clorix_access.actor() AND m.status='active'`;

export async function workspaces(client:PoolClient):Promise<Workspace[]> {
  return (await client.query<Workspace>(membershipSql+" ORDER BY w.created_at,w.id")).rows;
}

export async function withWorkspace<T>(request:Request, fn:(context:Context)=>Promise<T>, write=false) {
  const selected = request.headers.get("x-clorix-workspace");
  if (selected && !z.uuid().safeParse(selected).success) throw new AppError(404,"workspace","Workspace unavailable.");
  return actorContext(request.headers, async (client,user) => {
    const {rows:[workspace]} = await client.query<Workspace>(membershipSql +
      " AND ($1::uuid IS NULL OR w.id=$1) ORDER BY w.created_at,w.id LIMIT 1",[selected]);
    if (!workspace) throw new AppError(404,"workspace","This workspace is unavailable or its sandbox expired.");
    await client.query("SELECT set_config('clorix.tenant',$1,true)",[workspace.id]);
    if (write) {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,620102546))",[workspace.id]);
      const recheck = (await client.query<Workspace>(membershipSql+" AND w.id=$1",[workspace.id])).rows[0];
      if (!recheck) throw new AppError(403,"membership","Workspace access changed. Sign in again.");
      return fn({client,workspace:recheck,user});
    }
    return fn({client,workspace,user});
  },!write);
}

export function owner(context:Context) {
  if (context.workspace.role!=="owner" || context.workspace.kind!=="private") {
    throw new AppError(403,"owner","This action requires a private workspace owner.");
  }
}
