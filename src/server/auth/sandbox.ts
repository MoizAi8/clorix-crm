import { randomBytes } from "node:crypto";
import { z } from "zod";
import { transaction } from "@/server/db";
import { AppError,appOrigin,payload } from "@/server/http";
import { quotaHash,requestNetwork } from "@/server/quotas";

const browserToken=/^[A-Za-z0-9_-]{43}$/;
const token=()=>randomBytes(32).toString("base64url");
const secure=()=>appOrigin().startsWith("https:");
const cookieName=()=>secure()?"__Host-clorix-sandbox":"clorix-sandbox";

function browserKey(headers:Headers) {
  const value=headers.get("cookie")?.split(/;\s*/).find(item=>item.startsWith(cookieName()+"="))?.slice(cookieName().length+1);
  return value&&browserToken.test(value)?value:null;
}

export function prepareSandbox(request:Request) {
  if(request.headers.get("sec-fetch-site")==="cross-site")throw new AppError(403,"origin","Open the sandbox from Clorix.");
  const response=payload({ready:true});
  if(!browserKey(request.headers)) {
    response.headers.append("Set-Cookie",cookieName()+"="+token()+"; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400"+(secure()?"; Secure":""));
  }
  return response;
}

export async function admitSandbox(request:Request) {
  const browser=browserKey(request.headers);
  if(!browser) throw new AppError(409,"sandbox_cookie","Reload the sandbox page with cookies enabled, then try again.");
  const network=requestNetwork(request);
  const limit=z.coerce.number().int().min(1).max(20).parse(process.env.SANDBOX_IP_DAILY_LIMIT??12);
  const {rows:[result]}=await transaction(client=>client.query<{outcome:string;retry_after:number|null;session_token:string|null}>(
    "SELECT * FROM clorix_access.admit_sandbox($1,$2,$3,$4,$5)",
    [quotaHash("sandbox-browser",browser),quotaHash("sandbox-ip",network),quotaHash("sandbox-global","all"),limit,token()],
  ));
  if(result?.session_token) return {token:result.session_token,resumed:result.outcome==="resumed"};
  const retry=result?.retry_after??undefined;
  if(result?.outcome==="network") {
    throw new AppError(429,"sandbox_network","This network has reached its daily limit for new sandboxes. An existing sandbox can still be opened in its original browser.",retry);
  }
  if(result?.outcome==="global") {
    throw new AppError(429,"sandbox_daily","Clorix has reached today’s limit for new sandboxes. Existing sandboxes are still available.",retry);
  }
  if(result?.outcome==="capacity") {
    throw new AppError(429,"sandbox_capacity","All sandbox slots are in use. The retry time is based on the next scheduled workspace expiry.",retry);
  }
  throw new AppError(503,"sandbox_provision","Could not start a sandbox. Please retry.");
}
