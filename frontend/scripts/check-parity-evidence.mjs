import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const register = fs.readFileSync(path.join(root, 'docs', 'PARITY_EVIDENCE_REGISTER.md'), 'utf8');
const required = [
  'test-identity-access.mjs',
  'test-club-domain.mjs',
  'test-domain-canisters.mjs',
  'test-events-motoko-comparison.mjs',
  'test-notification-queue.mjs',
  'test-notification-upgrade.mjs',
  'test-timer-jobs.mjs',
  'test-timer-upgrade.mjs',
  'test-control-plane-federation.mjs',
  'test-placement-registry.mjs',
];
for (const script of required) {
  if (!register.includes(script)) throw new Error(`Parity evidence register missing ${script}`);
  if (!fs.existsSync(path.join(root, 'frontend', 'scripts', script))) throw new Error(`Parity evidence script missing ${script}`);
}
if (!register.includes('does not promote the domain rows')) throw new Error('Parity register must preserve the no-overclaim rule');
console.log(`Parity evidence register valid: ${required.length} executable probes indexed.`);
