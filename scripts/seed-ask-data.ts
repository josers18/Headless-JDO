#!/usr/bin/env tsx
/**
 * Dev seed for Ask My Data — inserts three fake threads spread across
 * Today / Yesterday / This Week so the sidebar sidebar visually verifies
 * groupThreadsByRecency without waiting for real conversations.
 *
 * Usage:
 *   npm run seed:ask-data            # insert 3 seed threads
 *   npm run seed:ask-data -- --clear # delete them (only the seeded ones)
 *
 * Owner user_id: DEMO_BANKER_USER_ID from .env, or the override passed
 * via SEED_USER_ID env var. Writes to whatever DATABASE_URL is set to —
 * run it against your own dev DB or accept that this touches Heroku
 * Postgres if your local .env points there.
 */

import {
  createThread,
  deleteThread,
  listThreads,
} from "../lib/db/askThreads";

const SEED_TITLES = [
  "HNW clients slipping on digital engagement",
  "Which accounts moved tier this year",
  "Life events missed in the last 30 days",
];

function userId(): string {
  // Treat empty strings as unset — DEMO_BANKER_USER_ID is present in .env
  // with an empty value in some setups, which the `??` fallback otherwise
  // accepts (it only falls through on undefined/null).
  const seeded = process.env.SEED_USER_ID?.trim();
  const demo = process.env.DEMO_BANKER_USER_ID?.trim();
  return seeded || demo || "seed-banker";
}

async function seed() {
  const uid = userId();
  console.log(`Seeding Ask My Data threads for user_id=${uid}`);
  for (const title of SEED_TITLES) {
    const row = await createThread({ userId: uid, title });
    console.log(`  + ${title}  (id=${row.id.slice(0, 8)}…)`);
  }
  console.log("Done. Visit /ask to see them grouped in the sidebar.");
}

async function clearSeed() {
  const uid = userId();
  console.log(`Clearing seeded threads for user_id=${uid}`);
  const all = await listThreads({ userId: uid });
  let removed = 0;
  for (const t of all) {
    if (SEED_TITLES.includes(t.title)) {
      const ok = await deleteThread({ id: t.id, userId: uid });
      if (ok) removed += 1;
    }
  }
  console.log(`Done. Removed ${removed} thread(s).`);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL not set. Abort.");
    process.exit(2);
  }
  const args = process.argv.slice(2);
  if (args.includes("--clear")) {
    await clearSeed();
  } else {
    await seed();
  }
  // pg Pool holds the event loop open.
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
