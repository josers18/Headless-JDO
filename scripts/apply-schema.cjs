/**
 * Heroku release-phase migration runner. Applies lib/db/schema.sql to
 * DATABASE_URL — idempotent (every CREATE uses `if not exists`). CJS +
 * the bundled `pg` from production deps so this works AFTER tsx /
 * devDependencies have been pruned but BEFORE the web dyno starts.
 *
 * Failure here aborts the release per Heroku contract — the new slug
 * does NOT go live if the migration errors. This is the desired
 * semantics: we'd rather rollback than ship code that depends on a
 * schema change that didn't apply.
 */

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[apply-schema] DATABASE_URL not set — skipping");
    return;
  }
  const schemaPath = path.join(__dirname, "..", "lib", "db", "schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf8");

  const client = new Client({
    connectionString: url,
    ssl: url.includes("localhost") ? false : { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query(sql);
    console.log("[apply-schema] schema applied OK");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[apply-schema] FAILED:", err);
  process.exit(1);
});
