import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle as drizzleNeon, type NeonDatabase } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePostgresJs, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import ws from "ws";
import * as schema from "./schema";

type Schema = typeof schema;
export type AppDb = PostgresJsDatabase<Schema> | NeonDatabase<Schema>;

let db: AppDb | null = null;
let shutdown: (() => Promise<void>) | null = null;

function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  return url;
}

/** Use Neon serverless driver (WebSocket on 443) when port 5432 is unavailable. */
export function isNeonServerlessDriver(): boolean {
  const driver = process.env.DATABASE_DRIVER?.toLowerCase();
  if (driver === "neon" || driver === "serverless") return true;
  if (process.env.USE_NEON_SERVERLESS === "1") return true;
  return false;
}

export function getDb(): AppDb {
  if (db) return db;

  const url = databaseUrl();

  if (isNeonServerlessDriver()) {
    neonConfig.webSocketConstructor = ws;
    const pool = new Pool({ connectionString: url });
    shutdown = async () => {
      await pool.end();
    };
    db = drizzleNeon(pool, { schema });
    return db;
  }

  const client = postgres(url, { max: 10, prepare: false });
  shutdown = async () => {
    await client.end();
  };
  db = drizzlePostgresJs(client, { schema });
  return db;
}

export async function closeDb(): Promise<void> {
  if (shutdown) {
    await shutdown();
    shutdown = null;
    db = null;
  }
}
