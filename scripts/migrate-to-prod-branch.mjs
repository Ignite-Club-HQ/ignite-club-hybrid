#!/usr/bin/env node
// Copy-only transfer of this repo into the prod repo as branch `hybrid`.
// Dry-run by default; `--apply` makes add-only changes; `--sync` fast-forwards an existing `hybrid`.
// Never modifies prod `main`, never overwrites existing prod items, never reads secret values.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SOURCE = process.env.SOURCE_REPO || "Ignite-Club-HQ/ignite-club-hybrid";
const DEST = process.env.DEST_REPO || "Ignite-Club-HQ/ignite-club_hq-prod";
const SOURCE_BRANCH = process.env.SOURCE_BRANCH || "main";
const DEST_BRANCH = "hybrid";
const APPLY = process.argv.includes("--apply");
const SYNC = process.argv.includes("--sync");
const TOKEN = process.env.MIGRATION_GITHUB_TOKEN || process.env.GITHUB_TOKEN;
if (!TOKEN) throw new Error("Set MIGRATION_GITHUB_TOKEN (repo + workflow + admin on both repos)");
if (DEST_BRANCH === "main") throw new Error("Refusing to target main");

async function gh(method, path, body, okMissing = false) {
  const res = await fetch(`https://api.github.com/${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (okMissing && res.status === 404) return null;
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${await res.text()}`);
  return res.status === 204 ? {} : res.json();
}
async function list(path, key) {
  const out = [];
  for (let page = 1; ; page++) {
    const r = await gh("GET", `${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`, null, true);
    const items = r ? (key ? r[key] : r) : [];
    out.push(...items);
    if (items.length < 100) return out;
  }
}
const names = (xs) => new Set(xs.map((x) => x.name));
const log = (...a) => console.log(...a);
const plan = [];

// 1. Self-starting workflow check: schedules only run from the default branch; push/PR filters must exclude `hybrid`.
function checkTriggers() {
  const dir = ".github/workflows";
  const risky = [];
  for (const f of readdirSync(dir)) {
    const y = readFileSync(join(dir, f), "utf8");
    for (const trig of ["push", "pull_request"]) {
      const m = y.match(new RegExp(`^  ${trig}:\\s*\\n((?:    .*\\n|\\s*\\n)*)`, "m"));
      if (!m && !new RegExp(`^on:.*\\b${trig}\\b`, "m").test(y)) continue;
      const branches = m?.[1].match(/branches:\s*\[([^\]]*)\]/)?.[1];
      if (!branches) { risky.push(`${f} (${trig}: no branch filter)`); continue; }
      if (branches.split(",").map((s) => s.trim().replace(/["']/g, "")).some((b) => b === DEST_BRANCH || b === "**" || b === "*"))
        risky.push(`${f} (${trig} matches ${DEST_BRANCH})`);
    }
  }
  return risky;
}

async function main() {
  log(`Mode: ${APPLY ? "APPLY (add-only)" : "dry-run"}${SYNC ? " + sync" : ""}\nSource ${SOURCE}@${SOURCE_BRANCH} -> ${DEST}@${DEST_BRANCH}\n`);
  const risky = checkTriggers();
  log(risky.length ? `Self-starting workflows that would fire on ${DEST_BRANCH}:\n  ${risky.join("\n  ")}` : `Workflows: none start on their own from ${DEST_BRANCH} (schedules run only from prod main).`);
  if (risky.length && APPLY) throw new Error("Disarm the listed triggers before applying");

  // 2. Branch
  const destRef = await gh("GET", `repos/${DEST}/git/ref/heads/${DEST_BRANCH}`, null, true);
  if (destRef && !SYNC) log(`Branch: ${DEST_BRANCH} already exists in prod; left untouched (use --sync to fast-forward).`);
  else plan.push(destRef ? "fast-forward branch" : "create branch");

  // 3. Secrets (names only), variables, environments
  const [srcSec, dstSec, srcVar, dstVar, srcEnv, dstEnv] = await Promise.all([
    list(`repos/${SOURCE}/actions/secrets`, "secrets"), list(`repos/${DEST}/actions/secrets`, "secrets"),
    list(`repos/${SOURCE}/actions/variables`, "variables"), list(`repos/${DEST}/actions/variables`, "variables"),
    list(`repos/${SOURCE}/environments`, "environments"), list(`repos/${DEST}/environments`, "environments"),
  ]);
  const dstSecN = names(dstSec), dstVarN = names(dstVar), dstEnvN = names(dstEnv);
  const missingSecrets = srcSec.filter((s) => !dstSecN.has(s.name)).map((s) => `repo: ${s.name}`);
  const missingVars = srcVar.filter((v) => !dstVarN.has(v.name));
  const sharedVars = srcVar.filter((v) => dstVarN.has(v.name)).map((v) => v.name);
  const missingEnvs = srcEnv.filter((e) => !dstEnvN.has(e.name));
  const envVarAdds = [];
  for (const e of srcEnv) {
    const enc = encodeURIComponent(e.name);
    const [es, ev] = await Promise.all([list(`repos/${SOURCE}/environments/${enc}/secrets`, "secrets"), list(`repos/${SOURCE}/environments/${enc}/variables`, "variables")]);
    const exists = dstEnvN.has(e.name);
    const [ds, dv] = exists ? await Promise.all([list(`repos/${DEST}/environments/${enc}/secrets`, "secrets"), list(`repos/${DEST}/environments/${enc}/variables`, "variables")]) : [[], []];
    const dsN = names(ds), dvN = names(dv);
    es.filter((s) => !dsN.has(s.name)).forEach((s) => missingSecrets.push(`environment ${e.name}: ${s.name}`));
    ev.filter((v) => !dvN.has(v.name)).forEach((v) => envVarAdds.push({ env: e.name, ...v }));
  }
  log(`\nVariables to add: ${missingVars.map((v) => v.name).join(", ") || "none"}`);
  if (sharedVars.length) log(`Variables already in prod (kept as-is, check they suit hybrid): ${sharedVars.join(", ")}`);
  log(`Environment variables to add: ${envVarAdds.map((v) => `${v.env}/${v.name}`).join(", ") || "none"}`);
  log(`Environments to add: ${missingEnvs.map((e) => e.name).join(", ") || "none"}`);
  const sharedSec = srcSec.filter((s) => dstSecN.has(s.name)).map((s) => s.name);
  if (sharedSec.length) log(`Secrets already in prod with the same name (kept; confirm they're right for hybrid): ${sharedSec.join(", ")}`);
  log(`\nSECRETS CHECKLIST: enter these yourself in prod Settings (values can't be copied):\n  ${missingSecrets.join("\n  ") || "none"}`);

  if (!APPLY) { log(`\nDry-run complete. Would also: ${[...plan, `protect ${DEST_BRANCH}`].join(", ")}.`); return; }

  // Apply: environments (add-only), variables (add-only), branch, protection
  for (const e of missingEnvs) {
    const full = await gh("GET", `repos/${SOURCE}/environments/${encodeURIComponent(e.name)}`);
    const reviewers = (full.protection_rules || []).flatMap((r) => r.reviewers || []).map((r) => ({ type: r.type, id: r.reviewer.id }));
    const wait = (full.protection_rules || []).find((r) => r.type === "wait_timer")?.wait_timer || 0;
    await gh("PUT", `repos/${DEST}/environments/${encodeURIComponent(e.name)}`, { wait_timer: wait, reviewers, deployment_branch_policy: full.deployment_branch_policy });
    if (full.deployment_branch_policy?.custom_branch_policies) {
      const pols = await list(`repos/${SOURCE}/environments/${encodeURIComponent(e.name)}/deployment-branch-policies`, "branch_policies");
      for (const p of pols) {
        const pattern = p.name === SOURCE_BRANCH ? DEST_BRANCH : p.name; // releases in prod come from hybrid, never prod main
        await gh("POST", `repos/${DEST}/environments/${encodeURIComponent(e.name)}/deployment-branch-policies`, { name: pattern, type: p.type || "branch" });
      }
    }
    log(`Added environment ${e.name}`);
  }
  for (const v of missingVars) { await gh("POST", `repos/${DEST}/actions/variables`, { name: v.name, value: v.value }); log(`Added variable ${v.name}`); }
  for (const v of envVarAdds) { await gh("POST", `repos/${DEST}/environments/${encodeURIComponent(v.env)}/variables`, { name: v.name, value: v.value }); log(`Added ${v.env}/${v.name}`); }

  if (!destRef || SYNC) {
    const dir = mkdtempSync(join(tmpdir(), "hybrid-"));
    const auth = ["-c", `http.extraheader=AUTHORIZATION: basic ${Buffer.from(`x-access-token:${TOKEN}`).toString("base64")}`];
    try {
      execFileSync("git", [...auth, "clone", "--bare", "--single-branch", "-b", SOURCE_BRANCH, `https://github.com/${SOURCE}.git`, dir], { stdio: "inherit" });
      // No --force: GitHub rejects anything that isn't a fast-forward.
      execFileSync("git", [...auth, "-C", dir, "push", `https://github.com/${DEST}.git`, `refs/heads/${SOURCE_BRANCH}:refs/heads/${DEST_BRANCH}`], { stdio: "inherit" });
      log(`${destRef ? "Fast-forwarded" : "Created"} ${DEST}@${DEST_BRANCH}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  const prot = await gh("GET", `repos/${DEST}/branches/${DEST_BRANCH}/protection`, null, true);
  if (!prot) {
    await gh("PUT", `repos/${DEST}/branches/${DEST_BRANCH}/protection`, {
      required_status_checks: null, enforce_admins: false, required_pull_request_reviews: null, restrictions: null,
      allow_force_pushes: false, allow_deletions: false,
    });
    log(`Protected ${DEST_BRANCH} (no force-push, no deletion)`);
  } else log(`${DEST_BRANCH} protection already present; left as-is`);
  log("\nDone. Prod main and existing prod settings were not changed.");
}
main().catch((e) => { console.error(e.message); process.exit(1); });
