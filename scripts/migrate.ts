import fs from "fs";
import path from "path";
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const sql = postgres(url, { max: 1 });
  const migrationsDir = path.join(process.cwd(), "drizzle");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  for (const file of files) {
    const id = file;
    const existing = await sql`SELECT id FROM schema_migrations WHERE id = ${id}`;
    if (existing.length > 0) continue;
    const body = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    await sql.unsafe(body);
    await sql`INSERT INTO schema_migrations (id) VALUES (${id})`;
    console.log(`Applied ${file}`);
  }

  await sql.end();
  console.log("Migrations complete");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
