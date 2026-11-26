import { betterAuth } from "better-auth";
import { anonymous } from "better-auth/plugins";
import { db } from "@/server/db";
import { appOrigin } from "@/server/http";
import { sandboxSession } from "./sandbox-session";

let instance: ReturnType<typeof makeAuth> | undefined;

function makeAuth() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("Authentication unavailable.");
  return betterAuth({
    appName: "Clorix",
    baseURL: appOrigin(),
    secret,
    database: db(),
    trustedOrigins: [appOrigin()],
    emailAndPassword:{ enabled:true,disableSignUp:true,minPasswordLength:12,maxPasswordLength:128 },
    advanced:{
      useSecureCookies: appOrigin().startsWith("https:"),
      database:{generateId:"uuid"},
      ipAddress:{disableIpTracking:true},
    },
    session:{expiresIn:60*60*24*7,updateAge:60*60*24,storeSessionInDatabase:true},
    rateLimit:{enabled:false},
    logger:{disabled:true},
    plugins:[sandboxSession,anonymous({
      emailDomainName:"sandbox.clorix.example",
      generateName:()=>"Sandbox evaluator",
      disableDeleteAnonymousUser:true,
    })],
  });
}

export function auth() {
  return instance ??= makeAuth();
}

export async function identity(headers: Headers) {
  return auth().api.getSession({headers});
}
