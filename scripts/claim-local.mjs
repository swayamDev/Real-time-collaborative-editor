// Local development only: give documents from before accounts (owned by the
// seed user the migration created) to a real account.
//
//   pnpm db:claim-local --email you@example.com
//
// Sign in once with that email first, so the account exists.
import { config } from "dotenv";
import pg from "pg";

config({ path: [".env.local", ".env"], quiet: true });

const index = process.argv.indexOf("--email");
const email = index === -1 ? null : process.argv[index + 1]?.trim().toLowerCase();
if (!email) {
  console.error("Usage: pnpm db:claim-local --email you@example.com");
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const { rows } = await client.query('SELECT id FROM "user" WHERE email = $1', [email]);
  if (rows.length === 0) {
    console.error(`No account for ${email}. Sign in with it once, then run this again.`);
    process.exitCode = 1;
  } else {
    const result = await client.query(
      "UPDATE documents SET owner_id = $1 WHERE owner_id = 'seed-local-owner'",
      [rows[0].id],
    );
    console.log(`${result.rowCount} documents now belong to ${email}.`);
  }
} finally {
  await client.end();
}
