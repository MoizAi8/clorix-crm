import { randomBytes } from "node:crypto";
import { z } from "zod";
import { token,tokenHash } from "@/server/auth/access";
import { audit } from "@/server/crm/records";
import { identifier,inviteInput,membershipInput,settingsInput } from "@/server/crm/validation";
import { AppError,appOrigin } from "@/server/http";
import { quota } from "@/server/quotas";
import { actorContext,owner,type Context } from "./context";

export async function settings(context:Context) {
  const {workspace,user,client}=context;
  const members=(await client.query(
    `SELECT m.id,m.role,m.status,u.name,CASE WHEN $2::boolean THEN u.email END AS email
      FROM memberships m JOIN "user" u ON u.id=m.user_id WHERE m.workspace_id=$1
      AND (m.status='active' OR $2::boolean) ORDER BY m.status,m.role DESC,u.name,m.id`,
    [workspace.id,workspace.kind==="private" && workspace.role==="owner"])).rows;
  const invites=workspace.kind==="private" && workspace.role==="owner"?(await client.query(
    "SELECT id,intended_email,role,expires_at,used_at,revoked_at FROM invites WHERE workspace_id=$1 AND expires_at>now() ORDER BY created_at DESC LIMIT 50",
    [workspace.id])).rows:[];
  return {workspace,profile:{name:user.name,email:workspace.kind==="private"?user.email:null},members,invites};
}

export async function updateSettings(context:Context,body:unknown) {
  owner(context);
  const input=settingsInput.parse(body);
  const {workspace,client}=context;
  if (input.expected_version!==workspace.version) throw new AppError(409,"stale","Workspace settings changed. Refresh and try again.");
  if (input.currency!==workspace.currency && (await client.query("SELECT 1 FROM deals WHERE workspace_id=$1 LIMIT 1",[workspace.id])).rowCount) {
    throw new AppError(409,"currency","Workspace currency is locked after the first deal.");
  }
  if (!(await client.query("SELECT 1 FROM pg_timezone_names WHERE name=$1",[input.timezone])).rowCount) {
    throw new AppError(422,"timezone","Choose a supported IANA time zone.");
  }
  await client.query("UPDATE workspaces SET name=$2,currency=$3,timezone=$4,updated_at=now(),version=version+1 WHERE id=$1",
    [workspace.id,input.name,input.currency,input.timezone]);
  await audit(context,"update","workspaces",workspace.id);
  return {updated:true};
}

export async function updateProfile(context:Context,body:unknown) {
  if (context.workspace.kind==="sandbox") throw new AppError(403,"sandbox","Sandbox profiles are fixed.");
  const {name}=z.strictObject({name:z.string().trim().min(1).max(100)}).parse(body);
  await context.client.query('UPDATE "user" SET name=$2,"updatedAt"=now() WHERE id=$1',[context.user.id,name]);
  return {updated:true};
}

export async function invite(request:Request,context:Context,body:unknown) {
  owner(context);
  await quota(request,"invite-user",12,3600,context.user.id);
  const input=inviteInput.parse(body);
  const secret=randomBytes(32).toString("base64url");
  const {rows:[offer]}=await context.client.query(
    `INSERT INTO invites(workspace_id,token_hash,intended_email,role,expires_at,created_by)
      VALUES($1,$2,$3,$4,now()+interval '2 days',$5) RETURNING id,expires_at`,
    [context.workspace.id,tokenHash(secret),input.email??null,input.role,context.user.id]);
  await audit(context,"create","invites",offer.id);
  const link=new URL("/join",appOrigin());
  link.hash=secret;
  return {...offer,link:link.href};
}

export async function accept(request:Request,body:unknown) {
  const input=z.strictObject({token}).parse(body);
  return actorContext(request.headers,async (client,user)=>{
    await quota(request,"accept-invite-user",10,3600,user.id);
    const {rows:[result]}=await client.query("SELECT clorix_access.accept_invite($1) AS id",[tokenHash(input.token)]);
    if (!result.id) throw new AppError(422,"invite","This invitation is invalid, expired or unavailable to this account.");
    return {id:result.id};
  });
}

export async function revoke(context:Context,id:string) {
  owner(context);
  const result=await context.client.query("UPDATE invites SET revoked_at=now() WHERE workspace_id=$1 AND id=$2 AND used_at IS NULL AND revoked_at IS NULL",
    [context.workspace.id,identifier.parse(id)]);
  if (!result.rowCount) throw new AppError(404,"invite","This active invitation is unavailable.");
  await audit(context,"revoke","invites",id);
  return {revoked:true};
}

export async function updateMember(context:Context,id:string,body:unknown) {
  owner(context);
  const {client,workspace}=context;
  const input=membershipInput.parse(body);
  const member=(await client.query<{user_id:string;role:string;status:string}>("SELECT user_id,role,status FROM memberships WHERE workspace_id=$1 AND id=$2",[workspace.id,id])).rows[0];
  if (!member) throw new AppError(404,"member","This workspace member is unavailable.");
  if (member.role===input.role && member.status===input.status) return {updated:true};
  if (member.role==="owner" && member.status==="active" && (input.role!=="owner" || input.status!=="active")) {
    const other=await client.query("SELECT 1 FROM memberships WHERE workspace_id=$1 AND role='owner' AND status='active' AND id<>$2 LIMIT 1",
      [workspace.id,id]);
    if (!other.rowCount) throw new AppError(409,"last_owner","A workspace must retain an active owner.");
  }
  await client.query("UPDATE memberships SET role=$3,status=$4 WHERE workspace_id=$1 AND id=$2",[workspace.id,id,input.role,input.status]);
  await client.query('DELETE FROM session WHERE "userId"=$1',[member.user_id]);
  await audit(context,"change_role","memberships",id);
  return {updated:true};
}
