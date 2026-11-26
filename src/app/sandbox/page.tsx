import { getSessionCookie } from "better-auth/cookies";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AccessForm } from "@/components/marketing/access-form";
import { AppError } from "@/server/http";
import { actorContext,workspaces } from "@/server/workspace/context";

export const metadata={title:"Live sandbox"};

export default async function Sandbox() {
  const incoming=new Headers(await headers());
  if(getSessionCookie(incoming)) {
    const active=await actorContext(incoming,client=>workspaces(client),true).catch(error=>{
      if(error instanceof AppError&&error.status===401)return [];
      throw error;
    });
    if(active.length)redirect("/workspace");
  }
  return <AccessForm mode="sandbox"/>;
}
