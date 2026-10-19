#!/usr/bin/env node
/** Capacity alert helper: reports CLOSED preparation requests newly queued at 70%.
 * Pure compare + optional GITHUB_OUTPUT emission; no network calls.
 * Usage: capacity-alert.mjs <prev-requests.json> <next-requests.json> [--github-output <path>]
 * Exits 0 always (the caller decides whether to alert). Missing/unreadable files fail closed.
 */
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function summarizeAlert(prevRequests, nextRequests) {
  const prevIds = new Set(prevRequests.map((r) => r.id));
  const added = nextRequests.filter((r) => !prevIds.has(r.id));
  return {
    addedCount: added.length,
    summary: added
      .map((r) => `${r.sourceGroupId} at ${r.percent}% (request ${r.id})`)
      .join('; '),
  };
}

function parseRequestsFile(path, label) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(`Cannot read ${label} requests file ${path}: ${error.message}`);
  }
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error(`${label} requests file must be a JSON array`);
  for (const entry of parsed) {
    if (typeof entry?.id !== 'string' || typeof entry?.sourceGroupId !== 'string' ||
        typeof entry?.percent !== 'number') {
      throw new Error(`${label} requests file has an invalid entry`);
    }
  }
  return parsed;
}

export function main(argv) {
  const args = argv.slice(2);
  if (args.length < 2) throw new Error('Usage: capacity-alert.mjs <prev.json> <next.json> [--github-output <path>]');
  const [prevPath, nextPath] = args;
  const outputIndex = args.indexOf('--github-output');
  const githubOutput = outputIndex >= 0 ? args[outputIndex + 1] : undefined;

  const prev = parseRequestsFile(prevPath, 'previous');
  const next = parseRequestsFile(nextPath, 'current');
  const { addedCount, summary } = summarizeAlert(prev, next);

  if (githubOutput) {
    appendFileSync(githubOutput, `added=${addedCount}\n`);
    appendFileSync(githubOutput, `summary<<EOF\n${summary || 'none'}\nEOF\n`);
  }
  console.log(`Newly queued closed requests: ${addedCount}${summary ? ` — ${summary}` : ''}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv);
}
