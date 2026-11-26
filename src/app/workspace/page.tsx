import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { identity } from "@/server/auth";
import { enabled } from "@/server/engine/gateway";
import { WorkspaceApp } from "@/components/workspace/workspace-app";

export const metadata={title:"Workspace"};

export default async function WorkspacePage() {
  const session=await identity(await headers()).catch(()=>null);
  if (!session) redirect("/sign-in");
  return <WorkspaceApp advanced={enabled()} />;
}
