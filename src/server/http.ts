import { randomUUID } from "node:crypto";
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public retry?: number) {
    super(message);
  }
}

export function payload(data: unknown, meta?: unknown, status = 200) {
  return Response.json({ data, ...(meta ? { meta } : {}) }, { status, headers: { "Cache-Control": "private, no-store" } });
}

export function failed(error: unknown) {
  const requestId = randomUUID();
  const databaseCode = (error as { code?: string } | null)?.code;
  if (databaseCode === "23503") error = new AppError(422, "relationship", "A selected record is unavailable in this workspace.");
  if (databaseCode === "23505") error = new AppError(409, "conflict", "A matching record already exists.");
  if (databaseCode === "P0001" && (error as Error).message === "commercial_currency") {
    error = new AppError(409,"currency_locked","Currency is locked after creating catalog items, sales targets or billing documents.");
  }
  if (databaseCode === "P0001" && (error as Error).message === "workflow_capacity") {
    error = new AppError(429,"workflow_capacity","Evaluate pending workflows before adding more events.",60);
  }
  if (databaseCode === "P0001" && (error as Error).message === "sandbox_capacity") {
    error = new AppError(429, "sandbox_capacity", "All sandbox slots are in use. Please try again later.", 3600);
  }
  const response = error instanceof AppError
    ? { status:error.status, code:error.code, message:error.message, retry:error.retry }
    : error instanceof ZodError
      ? { status:422,code:"validation",message:error.issues[0]?.message ?? "Check the submitted fields." }
      : { status:503,code:"unavailable",message:"Clorix is temporarily unavailable. Please retry." };
  if (response.status===503) console.error("clorix: request failed",requestId,databaseCode ?? (error as Error | null)?.name ?? "unknown");
  return Response.json({ error:{ code:response.code,message:response.message,requestId } },
    { status:response.status, headers:{ "Cache-Control":"private, no-store", ...(response.retry ? {"Retry-After":String(response.retry)} : {}) } });
}

export function appOrigin() {
  const url = process.env.APP_URL || "http://localhost:3000";
  return new URL(url).origin;
}

export function requireOrigin(request: Request) {
  if (request.headers.get("origin") !== appOrigin() || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new AppError(403,"origin","This request must come from Clorix.");
  }
}

export async function jsonBody(request: Request, maximum = 32768): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new AppError(415,"content_type","Use a JSON request.");
  }
  if (Number(request.headers.get("content-length")) > maximum) throw new AppError(413,"size","Request exceeds the size limit.");
  const reader = request.body?.getReader();
  if (!reader) throw new AppError(400,"body","A request body is required.");
  let size = 0;
  const decoder = new TextDecoder("utf-8",{fatal:true});
  const chunks: string[] = [];
  try {
    while (true) {
      const {value,done} = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maximum) {
        await reader.cancel();
        throw new AppError(413,"size","Request exceeds the size limit.");
      }
      chunks.push(decoder.decode(value,{stream:true}));
    }
    chunks.push(decoder.decode());
    return JSON.parse(chunks.join(""));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400,"body","The JSON request could not be read.");
  } finally {
    reader.releaseLock();
  }
}
