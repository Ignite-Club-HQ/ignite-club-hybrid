// Ignite Club HQ — AI memory-growth analysis (runs in the Canister health workflow).
//
// 1. Reads this run's readings (HEALTH_JSON_OUT from canister-health.mjs).
// 2. Loads earlier readings (workflow + admin hand-entered) from
//    insights_domain and, when configured, Supabase.
// 3. Asks the Lovable AI Gateway which canisters show unusual growth.
// 4. Saves readings + analysis to both stores; only app admins can read them.
// Needs: icp CLI with the governor identity; LOVABLE_API_KEY (skips AI without it);
// optional SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.env.GITHUB_WORKSPACE || process.cwd();
const ids = JSON.parse(readFileSync(join(root, "deploy/mainnet/.icp/data/mappings/ic.ids.json"), "utf8"));
const insights = ids.insights_domain;
const current = JSON.parse(readFileSync(process.env.HEALTH_JSON_OUT, "utf8"));

function icp(args) {
  return execFileSync("icp", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20 });
}

// Candid text literal -> JS string (handles \" \\ \n \t \u{..} and \xx byte escapes).
function unescapeCandid(s) {
  const bytes = [];
  const enc = new TextEncoder();
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== "\\") { bytes.push(...enc.encode(c)); continue; }
    const n = s[++i];
    if (n === "n") bytes.push(10);
    else if (n === "t") bytes.push(9);
    else if (n === "r") bytes.push(13);
    else if (n === "u") { const end = s.indexOf("}", i); bytes.push(...enc.encode(String.fromCodePoint(parseInt(s.slice(i + 2, end), 16)))); i = end; }
    else if (/[0-9a-f]/i.test(n)) { bytes.push(parseInt(s.slice(i, i + 2), 16)); i++; }
    else bytes.push(...enc.encode(n));
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}
const escapeCandid = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");

const history = [];
try {
  const out = icp(["canister", "call", insights, "list_memory_reports", "(30 : nat)", "-n", "ic"]);
  const re = /at = (-?[\d_]+)[^;]*;\s*source = "((?:[^"\\]|\\.)*)";\s*readings_json = "((?:[^"\\]|\\.)*)"/g;
  for (const m of out.matchAll(re)) {
    try {
      history.push({ at: new Date(Number(BigInt(m[1].replace(/_/g, "")) / 1_000_000n)).toISOString(), source: unescapeCandid(m[2]), readings: JSON.parse(unescapeCandid(m[3])) });
    } catch { /* skip malformed */ }
  }
} catch (err) {
  console.log("::warning::Could not load on-chain history (needs the latest insights_domain deploy):", String(err.stderr ?? err).slice(0, 300));
}

const sbUrl = process.env.SUPABASE_URL;
const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sbHeaders = sbKey ? { apikey: sbKey, Authorization: `Bearer ${sbKey}`, "Content-Type": "application/json" } : null;
if (sbUrl && sbHeaders) {
  const res = await fetch(`${sbUrl}/rest/v1/canister_memory_reports?select=created_at,source,readings&source=eq.manual&order=created_at.desc&limit=30`, { headers: sbHeaders });
  if (res.ok) for (const r of await res.json()) history.push({ at: r.created_at, source: r.source, readings: r.readings });
}
history.sort((a, b) => a.at.localeCompare(b.at));

let analysis = null;
const key = process.env.LOVABLE_API_KEY;
if (!key) {
  console.log("::warning::No LOVABLE_API_KEY secret — saving readings without AI analysis.");
} else {
  const schema = {
    type: "object", additionalProperties: false, required: ["summary", "canisters"],
    properties: {
      summary: { type: "string" },
      canisters: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "status", "explanation"],
        properties: { name: { type: "string" }, status: { type: "string", enum: ["ok", "watch", "attention"] }, explanation: { type: "string" } } } },
    },
  };
  const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Lovable-AIG-SDK": "fetch" },
    body: JSON.stringify({
      model: "openai/gpt-6-astra",
      stream: true,
      store: false,
      reasoning: { effort: "low" },
      text: { format: { type: "json_schema", name: "memory_analysis", strict: true, schema } },
      instructions:
        "You review Internet Computer canister memory for a sports-club app. Each canister has a 4 GB memory ceiling (media_blob_store stores photos and grows fastest; it rejects uploads above 80% of its store). " +
        "Compare the current readings with history, flag unusual or accelerating growth, estimate time to ceiling when growing, and note low cycles. " +
        "Use plain English for a non-technical owner. Only list canisters with status watch or attention, plus at most two ok ones worth mentioning.",
      input: JSON.stringify({ now: new Date().toISOString(), current, history }),
    }),
  });
  if (!res.ok) {
    console.log(`::warning::AI Gateway returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
  } else {
    let buf = "", text = "";
    const dec = new TextDecoder();
    for await (const chunk of res.body) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        try {
          const ev = JSON.parse(line.slice(5));
          if (ev.type === "response.output_text.delta") text += ev.delta;
          if (ev.type === "response.refusal.delta" || ev.type === "error") console.log("::warning::AI declined:", line.slice(0, 200));
        } catch { /* partial */ }
      }
    }
    try { analysis = JSON.parse(text); } catch { console.log("::warning::AI reply was not valid JSON"); }
  }
}

if (analysis) {
  console.log(`\nAI summary: ${analysis.summary}`);
  for (const c of analysis.canisters) {
    console.log(`  [${c.status}] ${c.name}: ${c.explanation}`);
    if (c.status === "attention") console.log(`::warning::${c.name}: ${c.explanation}`);
  }
}

const readingsJson = JSON.stringify(current);
const analysisJson = analysis ? JSON.stringify(analysis) : "";
try {
  icp(["canister", "call", insights, "add_memory_report", `("workflow", "${escapeCandid(readingsJson)}", "${escapeCandid(analysisJson)}")`, "-n", "ic"]);
  console.log("Saved report on-chain.");
} catch (err) {
  console.log("::warning::Could not save on-chain report:", String(err.stderr ?? err).slice(0, 300));
}
if (sbUrl && sbHeaders) {
  const res = await fetch(`${sbUrl}/rest/v1/canister_memory_reports`, {
    method: "POST", headers: { ...sbHeaders, Prefer: "return=minimal" },
    body: JSON.stringify({ source: "workflow", readings: current, analysis }),
  });
  console.log(res.ok ? "Saved report to Supabase." : `::warning::Supabase save failed: ${res.status}`);
}
