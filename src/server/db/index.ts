import { Pool, type PoolClient } from "pg";

const state = globalThis as typeof globalThis & { clorixPool?: Pool };

export function db(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Database unavailable.");
  if (!state.clorixPool) {
    state.clorixPool = new Pool({
      connectionString, max: 5, idleTimeoutMillis: 10000, connectionTimeoutMillis: 8000,
    });
    state.clorixPool.on("error", () => console.error("clorix: idle database connection closed"));
  }
  return state.clorixPool;
}

export async function transaction<T>(fn: (client: PoolClient) => Promise<T>, readOnly=false): Promise<T> {
  const client = await db().connect();
  try {
    await client.query(readOnly?"BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY":"BEGIN");
    await client.query("SET LOCAL statement_timeout = '8s'");
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
