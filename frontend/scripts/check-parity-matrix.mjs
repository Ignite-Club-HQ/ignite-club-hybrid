import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const topology = JSON.parse(fs.readFileSync(path.join(root, 'icp-domain-topology.json'), 'utf8'));
const matrix = fs.readFileSync(path.join(root, 'docs', 'PARITY_IMPLEMENTATION_MATRIX.md'), 'utf8');
const allowed = new Set(['implemented_and_proven', 'poc_needs_parity', 'external_boundary', 'supabase_only', 'not_enabled']);
const requiredRoles = topology.roles.filter(role => role.kind !== 'control_plane');
const rows = matrix.split('\n').filter(line => line.startsWith('|') && !line.startsWith('| ---') && !line.includes('Domain |') && !line.includes('Function class |'));
const aliases = {
  identity_access: 'Identity/access',
  club_domain: 'Club/team',
  events_domain: 'Events',
  competition_domain: 'Competition',
  messaging_domain: 'Messaging',
  media_metadata: 'Media',
  notification_queue: 'Notifications',
  timer_jobs: 'Timers',
};
const rowFor = (name) => rows.find(row => row.includes(`| \`${name}\` |`) || row.includes(`| ${name} |`) || row.startsWith(`| ${aliases[name]} |`));
const missing = [];
for (const role of requiredRoles) {
  const row = rowFor(role.name);
  if (!row) missing.push(`${role.name}: missing parity row`);
  else if (![...allowed].some(status => row.includes(`| \`${status}\` |`))) missing.push(`${role.name}: missing allowed parity status`);
}
for (const status of matrix.matchAll(/`([^`]+)`/g)) {
  const value = status[1];
  if (value.includes('_') && ['implemented_and_proven', 'poc_needs_parity', 'external_boundary', 'supabase_only', 'not_enabled'].includes(value) === false && ['site_id', 'club_id', 'team_id', 'media_metadata', 'identity_access', 'events_domain', 'competition_domain', 'messaging_domain', 'notification_queue', 'timer_jobs', 'club_domain'].includes(value) === false) {
    // Ignore domain names and ordinary inline identifiers; status validation is row-based.
  }
}
if (missing.length) throw new Error(`Parity matrix invalid:\n${missing.join('\n')}`);
console.log(`Parity matrix valid: ${requiredRoles.length} non-control roles have explicit status rows.`);
