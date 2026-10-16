// Free clubs keep uploaded media for 6 months; Pro/trial clubs keep it forever.
// Deletes expired files from Supabase storage, then their gallery/vault records.
// Run daily by .github/workflows/free-media-retention.yml. No-op without secrets.
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.log("::notice::SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — skipping.");
  process.exit(0);
}
const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

async function rpc(name, body = {}) {
  const r = await fetch(`${url}/rest/v1/rpc/${name}`, { method: "POST", headers, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${name}: ${r.status} ${await r.text()}`);
  return r.json();
}

let removed = 0;
for (let round = 0; round < 20; round++) {
  const rows = await rpc("list_expired_free_media", { _limit: 500 });
  if (!rows.length) break;
  const byBucket = {};
  for (const { bucket_id, name } of rows) (byBucket[bucket_id] ??= []).push(name);
  for (const [bucket, prefixes] of Object.entries(byBucket)) {
    const r = await fetch(`${url}/storage/v1/object/${bucket}`, { method: "DELETE", headers, body: JSON.stringify({ prefixes }) });
    if (!r.ok) throw new Error(`delete ${bucket}: ${r.status} ${await r.text()}`);
    removed += prefixes.length;
  }
}
const rowsPurged = await rpc("purge_expired_free_media_rows");
console.log(`Removed ${removed} files and ${rowsPurged} records older than 6 months from free clubs.`);
