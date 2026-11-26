import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { identity } from "@/server/auth";
import { copilotEnabled,enabled } from "@/server/engine/gateway";
import { WorkspaceApp } from "@/components/workspace/workspace-app";

export const metadata={title:"Workspace"};

export default async function WorkspacePage() {
  const requestHeaders=await headers();
  const session=await identity(requestHeaders).catch(()=>null);
  if (!session) redirect("/sign-in");
  return <WorkspaceApp advanced={enabled()} copilot={copilotEnabled(session.user.id,requestHeaders.get("x-vercel-ip-country"))} />;
}
