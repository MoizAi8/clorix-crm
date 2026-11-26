import { forward } from "@/server/engine/gateway";
import { failed } from "@/server/http";

export const runtime="nodejs";
export const dynamic="force-dynamic";

type Context={params:Promise<{parts:string[]}>};

async function handle(request:Request,context:Context) {
  try {
    return await forward(request,(await context.params).parts);
  } catch (error) {
    return failed(error);
  }
}

export const GET=handle;
export const POST=handle;
export const PATCH=handle;
export const DELETE=handle;
