import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: [".env.local", ".env"], quiet: true });

// Migrations use the direct (unpooled) connection. On Neon, PgBouncer in
// transaction mode does not suit schema changes. Locally both URLs are the same.
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) {
  throw new Error("Set DATABASE_URL_UNPOOLED or DATABASE_URL to run migrations.");
}

export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/db/schema.ts", "./src/db/auth-schema.ts"],
  out: "./drizzle",
  dbCredentials: { url },
  strict: true,
});
