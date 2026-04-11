/**
 * Builds the UFC fighter cache and writes it directly to Cloudflare KV.
 *
 * Usage:
 *   npm run build-cache          # writes to production KV
 *   npm run build-cache:dev      # writes to preview KV (for local wrangler dev)
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchAllAthleteIds, fetchAthleteDetail } from "../src/espn.ts";

// ── Resolve KV namespace ID from wrangler.jsonc ──────────────────────────────

const env = process.argv.includes("--env")
  ? process.argv[process.argv.indexOf("--env") + 1]
  : "production";

const isPreview = env === "preview";

const wranglerPath = new URL("../wrangler.jsonc", import.meta.url).pathname;
const wranglerRaw = readFileSync(wranglerPath, "utf-8")
  // Strip single-line comments (jsonc)
  .replace(/\/\/[^\n]*/g, "");
const wrangler = JSON.parse(wranglerRaw) as {
  kv_namespaces: { binding: string; id: string; preview_id: string }[];
};

const kvBinding = wrangler.kv_namespaces.find((ns) => ns.binding === "FIGHTERS_KV");
if (!kvBinding) {
  console.error("Could not find FIGHTERS_KV binding in wrangler.jsonc");
  process.exit(1);
}

const namespaceId = isPreview ? kvBinding.preview_id : kvBinding.id;
console.log(`[build-cache] env=${env}, namespace=${namespaceId}`);

// ── Fetch all athletes ────────────────────────────────────────────────────────

console.log("[build-cache] fetching all athlete IDs...");
const ids = await fetchAllAthleteIds();
console.log(`[build-cache] ${ids.length} IDs — fetching details in batches of 10`);

const kvEntries: { key: string; value: string }[] = [];
const nameIndex: { id: string; name: string }[] = [];
let stored = 0;
let skipped = 0;
const totalBatches = Math.ceil(ids.length / 10);

for (let i = 0; i < ids.length; i += 10) {
  const batch = ids.slice(i, i + 10);
  const batchNum = Math.floor(i / 10) + 1;
  process.stdout.write(`\r[build-cache] batch ${batchNum}/${totalBatches} (${stored} stored)`);

  const results = await Promise.all(batch.map(fetchAthleteDetail));
  for (const athlete of results) {
    if (!athlete || !athlete.name) { skipped++; continue; }
    kvEntries.push({ key: `athlete:${athlete.id}`, value: JSON.stringify(athlete) });
    nameIndex.push({ id: athlete.id, name: athlete.name });
    stored++;
  }
}

console.log(`\n[build-cache] ${stored} athletes fetched, ${skipped} skipped`);

// ── Add name index entry ──────────────────────────────────────────────────────

kvEntries.push({ key: "__name_index", value: JSON.stringify(nameIndex) });

// ── Write to KV via wrangler bulk put ─────────────────────────────────────────

const tmpFile = join(tmpdir(), `gu-cache-${Date.now()}.json`);
writeFileSync(tmpFile, JSON.stringify(kvEntries));

console.log(`[build-cache] writing ${kvEntries.length} KV entries...`);
try {
  execSync(
    `npx wrangler kv bulk put "${tmpFile}" --namespace-id "${namespaceId}"`,
    { stdio: "inherit" }
  );
  console.log("[build-cache] done.");
} finally {
  unlinkSync(tmpFile);
}
