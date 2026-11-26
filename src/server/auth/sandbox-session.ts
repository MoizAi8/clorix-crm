import type { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";

// Only called by the app's sandbox route after the database admits this browser.
// Clorix does not mount Better Auth's generic HTTP handler.
export const sandboxSession = {
  id:"clorix-sandbox-session",
  endpoints:{
    issueSandboxSession:createAuthEndpoint({
      method:"POST",
      body:z.strictObject({token:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}),
    },async ctx=>{
      const identity=await ctx.context.internalAdapter.findSession(ctx.body.token);
      if(!identity||!identity.user.isAnonymous) return ctx.json({path:null},{status:503});
      await setSessionCookie(ctx,identity);
      return ctx.json({path:"/workspace"});
    }),
  },
} satisfies BetterAuthPlugin;
