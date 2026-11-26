import { createHash } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import { auth, identity } from "@/server/auth";
import { db } from "@/server/db";
import { AppError, appOrigin, jsonBody, payload } from "@/server/http";
import { quota } from "@/server/quotas";
import { actorContext, workspaces } from "@/server/workspace/context";

export const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const tokenHash = (value:string) => createHash("sha256").update(value).digest("hex");
const credentials = z.strictObject({
  email:z.email().max(254).transform(s=>s.toLowerCase()),
  password:z.string().min(12,"Use at least 12 password characters.").max(128),
});
const registration = credentials.extend({ token,name:z.string().trim().min(1).max(100) });

function sessionResponse(response:Response, data:unknown) {
  const safe = payload(data);
  for (const cookie of response.headers.getSetCookie()) safe.headers.append("Set-Cookie",cookie);
  return safe;
}

function trustedAuthHeaders(request:Request) {
  const headers=new Headers(request.headers);
  headers.set("origin",appOrigin());
  return headers;
}

export async function access(request:Request, operation:string) {
  const headers=trustedAuthHeaders(request);
  const body=await jsonBody(request,8192);
  switch (operation) {
    case "sandbox": {
      z.strictObject({ synthetic:z.literal(true) }).parse(body);
      if (process.env.PUBLIC_SANDBOX_ENABLED==="false") throw new AppError(503,"sandbox_off","The live sandbox is temporarily unavailable.");
      const current = await identity(headers);
      if (current) {
        const active = await actorContext(headers,async client => workspaces(client));
        if (active.length) return payload({ path:"/workspace" });
        throw new AppError(410,"sandbox_expired","Your sandbox expired. Sign out before starting another.");
      }
      const limit = z.coerce.number().int().min(1).max(20).parse(process.env.SANDBOX_IP_DAILY_LIMIT ?? 3);
      await quota(request,"sandbox-ip",limit,86400);
      await quota(request,"sandbox-global",90,86400,"all");
      await db().query("SELECT clorix_access.cleanup_guests(5,false)");
      const result=await auth().api.signInAnonymous({headers,asResponse:true});
      if (!result.ok) throw new AppError(503,"sandbox_provision","Could not start a sandbox. Try again later.");
      return sessionResponse(result,{path:"/workspace"});
    }
    case "login": {
      await quota(request,"login-ip",30,900);
      const input=credentials.parse(body);
      await quota(request,"login-account",10,900,input.email);
      const result=await auth().api.signInEmail({headers,body:input,asResponse:true});
      if (!result.ok) throw new AppError(401,"credentials","The email or password is incorrect.");
      return sessionResponse(result,{path:"/workspace"});
    }
    case "register": {
      await quota(request,"register-ip",10,3600);
      if (await identity(headers)) throw new AppError(409,"signed_in","Sign out before registering another account.");
      const input=registration.parse(body);
      const password=await hashPassword(input.password);
      const {rows}=await db().query("SELECT clorix_access.register_private($1,$2,$3,$4) AS allowed",
        [tokenHash(input.token),input.email,input.name,password]);
      if (!rows[0]?.allowed) throw new AppError(422,"registration","This account invitation is invalid or expired.");
      const result=await auth().api.signInEmail({headers,body:{email:input.email,password:input.password},asResponse:true});
      return result.ok ? sessionResponse(result,{path:"/workspace"}) : payload({path:"/sign-in"});
    }
    case "logout": {
      z.strictObject({}).parse(body);
      const result=await auth().api.signOut({headers,asResponse:true});
      if (!result.ok) throw new AppError(503,"logout","Could not sign out. Please try again.");
      return sessionResponse(result,{path:"/"});
    }
    default: throw new AppError(404,"route","Action unavailable.");
  }
}
