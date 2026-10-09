import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

let client: ReturnType<typeof postgres> | null = null;

function getClient() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  if (!client) {
    client = postgres(url, { max: 10, prepare: false });
  }
  return client;
}

export function getDb() {
  return drizzle(getClient(), { schema });
}

export async function closeDb() {
  if (client) {
    await client.end();
    client = null;
  }
}
