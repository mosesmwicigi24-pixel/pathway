// Seeds the teaching_quotes library (STEP 3 of the sermon-quotes build) from
// the staged corpus at scripts/sermon-corpus/*.txt (Step 1) via the shared
// extraction/seeding logic in src/modules/intelligence/teachingQuotes.ts —
// see that file (and scripts/sermon-corpus/CURATION.md) for the extraction
// rules and the documents excluded from it.
//
// Idempotent: safe to re-run. Run:
//   DATABASE_URL=postgres://nuru:nuru@localhost:5432/nuru \
//     pnpm --filter @nuru/backend seed:teaching-quotes
import "dotenv/config";
import pg from "pg";
import { seedTeachingQuotesFromCorpus } from "../src/modules/intelligence/teachingQuotes.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url });
try {
  const result = await seedTeachingQuotesFromCorpus(pool);
  console.log(
    `Teaching quotes seeded: ${result.documentsRead} documents read ` +
      `(${result.documentsExcluded} excluded from extraction), ` +
      `${result.candidatesExtracted} candidate lines after dedup, ` +
      `${result.quotesInserted} inserted, ${result.duplicatesSkipped} already present.`,
  );
} catch (e) {
  console.error("FAILED:", (e as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
