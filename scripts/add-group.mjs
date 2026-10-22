/** One-click "Add new group": install, configure, verify and open a new club
 * group on mainnet, then record the live approval so the published app uses
 * it without a new release. Re-run to resume; finished steps are skipped and
 * every child step re-verifies live state before changing anything.
 *
 * Usage: node scripts/add-group.mjs <groupId|auto> <operator.pem> <wasmDir> <workDir>
 * Env: CONFIRMATION (ADD GROUP), GITHUB_REPOSITORY, GITHUB_SHA, GH_TOKEN, push-worker vars. */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { STEPS, confirmed, chooseGroup, startOrResume, remainingSteps, markDone, openingRecord, retryable, settingsNeedReload, CONFIRMATION } from './add-group-plan.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [groupInput, pemArg, wasmArg, workArg] = process.argv.slice(2);
if (!pemArg || !wasmArg || !workArg) throw new Error('Usage: add-group.mjs <groupId|auto> <operator.pem> <wasmDir> <workDir>');
if (!confirmed(process.env.CONFIRMATION)) throw new Error(`Type ${CONFIRMATION} to confirm`);
const pem = resolve(pemArg), wasmDir = resolve(wasmArg), work = resolve(workArg);
mkdirSync(work, { recursive: true });

const groupsDir = join(root, 'deploy/groups');
const known = readdirSync(groupsDir).filter(n => /^g\d+$/.test(n));
const progressFile = id => join(groupsDir, id, 'add-group-progress.json');
const readJson = f => JSON.parse(readFileSync(f, 'utf8'));
const progressByGroup = Object.fromEntries(known.filter(id => existsSync(progressFile(id))).map(id => [id, readJson(progressFile(id))]));
const groupId = chooseGroup(groupInput, progressByGroup, known);
const NUM = groupId.slice(1), LABEL = `Group ${NUM}`;
const gdir = join(groupsDir, groupId);
mkdirSync(gdir, { recursive: true });
let progress = startOrResume(progressByGroup[groupId], groupId, process.env.GITHUB_SHA, new Date().toISOString());
const save = () => writeFileSync(progressFile(groupId), JSON.stringify(progress, null, 2) + '\n');
save();
const summary = line => { console.log(line); if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, line + '\n'); };
summary(`### Adding ${LABEL} (${groupId})`);
if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `GROUP_ID=${groupId}\n`);

const approvalFile = join(gdir, 'general-opening.json');
const approvalArg = `../deploy/groups/${groupId}/general-opening.json`;
/** Run a child step, echo its output, return { ok, output }. */
function run(cmd, args, { cwd = root, env = {} } = {}) {
  const r = spawnSync(cmd, args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  process.stdout.write(output);
  return { ok: r.status === 0, output };
}
const tsx = (script, args, env) => run('npx', ['--yes', 'tsx@4', `scripts/${script}`, ...args], { cwd: join(root, 'frontend'), env });
const opening = (action, confirmation) => tsx('open-group-general.ts', [action, approvalArg, pem],
  { CONFIRMATION: confirmation ?? '', ADD_GROUP_RESUME: '1' });

const actions = {
  support: () => {
    const probe = tsx('probe-group-support.ts', [pem]);
    if (!probe.ok) return probe;
    const need = JSON.parse(probe.output.trim().split('\n').at(-1));
    if (need.router && need.identity) return { ok: true, output: '' };
    summary('One-time upgrade of the shared directory/account services for live approvals.');
    const up = run('bash', ['scripts/upgrade-group-support.sh', need.router ? '0' : '1', need.identity ? '0' : '1']);
    if (!up.ok) return up;
    const again = tsx('probe-group-support.ts', [pem]);
    const now = again.ok ? JSON.parse(again.output.trim().split('\n').at(-1)) : {};
    return now.router && now.identity ? { ok: true, output: '' } : { ok: false, output: 'Shared services still lack group support after upgrade' };
  },
  install: () => tsx('install-group-closed.ts', [groupId, pem], { WASM_DIR: wasmDir, REQUEST_ID: process.env.REQUEST_ID || 'manual' }),
  'approval-file': () => {
    if (existsSync(approvalFile)) {
      const existing = readJson(approvalFile);
      if (existing.groupId !== groupId) return { ok: false, output: `Existing opening record is not for ${groupId}` };
      return { ok: true, output: '' };
    }
    const shared = readJson(join(root, 'deploy/mainnet/.icp/data/mappings/ic.ids.json'));
    writeFileSync(approvalFile, JSON.stringify(openingRecord(groupId, readJson(join(gdir, 'provision.json')), shared), null, 2) + '\n');
    return { ok: true, output: '' };
  },
  register: () => opening('register-closed', `REGISTER GROUP ${NUM} CLOSED`),
  settings: () => {
    const r = tsx('set-group-service-settings.ts', [groupId, pem, join(work, 'settings.json')], { CONFIRMATION: 'SET SERVICE SETTINGS' });
    return r.ok || settingsNeedReload(r.output) ? { ok: true, output: r.output } : r;
  },
  reload: () => run(process.execPath, [join(root, 'frontend/scripts/upgrade-group2.mjs'), 'reload', wasmDir, pem, join(work, 'reload')],
    { env: { GROUP_ID: groupId, CONFIRMATION: `RELOAD GROUP ${NUM} SETTINGS` } }),
  'settings-loaded': () => tsx('set-group-service-settings.ts', [groupId, pem, join(work, 'settings.json')], { CONFIRMATION: 'SET SERVICE SETTINGS' }),
  hashes: () => opening('prepare-hashes'),
  admission: () => tsx('authorize-group-admission.ts', [groupId, approvalArg, pem]),
  check: () => opening('check'),
  open: () => opening('open', `OPEN GROUP ${NUM} TO EVERYONE`),
  approve: () => tsx('produce-routing-gates.ts', [pem, join(work, 'routing-gates-report.json')], { RECORD_ROUTING_APPROVAL: '1' }),
};
if (Object.keys(actions).join() !== STEPS.join()) throw new Error('Step table mismatch');
mkdirSync(join(work, 'reload'), { recursive: true });

for (const step of remainingSteps(progress)) {
  summary(`- ${step}…`);
  let result;
  for (let attempt = 1; attempt <= 3; attempt++) {
    result = actions[step]();
    if (result.ok || !retryable(step, result.output)) break;
    summary(`  ${step} saw a concurrent change; retrying (${attempt}/3)`);
  }
  if (!result.ok) {
    const reason = result.output.split('\n').map(l => l.trim()).filter(Boolean).filter(l => /error|refus|required|missing|fail/i.test(l)).at(-1) ?? 'see log';
    summary(`**Stopped at ${step}.** ${reason}`);
    summary('Nothing is lost: fix the reason above (for example add fuel), then run Add new group again — it continues from here.');
    process.exit(1);
  }
  progress = markDone(progress, step, new Date().toISOString());
  save();
}
summary(`**${LABEL} is open to new clubs.** The live approval is recorded, so the published app uses it now — no app release needed.`);
