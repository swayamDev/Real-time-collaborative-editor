import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
  }
  return new Pool({ connectionString, max: 10 });
}

// Reuse one pool across hot reloads in development.
const globalForDb = globalThis as unknown as { brahmaPool?: Pool };

function getPool(): Pool {
  globalForDb.brahmaPool ??= createPool();
  return globalForDb.brahmaPool;
}

let instance: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function db() {
  instance ??= drizzle(getPool(), { schema });
  return instance;
}
