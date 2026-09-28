import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'icp-domain-topology.json'), 'utf8'));
if (manifest.schema !== 1 || manifest.logical_canister_count !== manifest.roles.length) throw new Error('Invalid topology manifest');
const cargo = fs.readFileSync(path.join(root, 'Cargo.toml'), 'utf8');
const rls = fs.readFileSync(path.join(root, 'docs', 'RLS_DOMAIN_INVENTORY.md'), 'utf8');
const mops = fs.readFileSync(path.join(root, 'mops.toml'), 'utf8');
for (const role of manifest.roles) {
  if (!role.name || !role.path || !role.status || !role.shard_key) throw new Error(`Incomplete topology role: ${role.name}`);
  const exists = fs.existsSync(path.join(root, role.path));
  if (['poc', 'implemented_poc', 'implemented'].includes(role.status) && !exists) throw new Error(`Implemented role path missing: ${role.name}`);
  if (role.status === 'planned' && exists) throw new Error(`Planned role has an unexpected implementation path: ${role.name}`);
  if (!role.rls_gate) throw new Error(`Missing RLS/privacy gate: ${role.name}`);
  if (role.status !== 'external_boundary') {
    const rolePath = path.join(root, role.path);
    const candid = fs.readdirSync(rolePath).find((file) => file.endsWith('.did'));
    if (!candid && role.status !== 'planned') throw new Error(`Missing Candid contract: ${role.name}`);
    if (role.status !== 'planned' && role.kind !== 'control_plane' && !rls.includes(role.rls_gate)) throw new Error(`RLS/privacy gate not recorded: ${role.name}`);
    if (fs.existsSync(path.join(rolePath, 'Cargo.toml')) && !cargo.includes(role.path)) throw new Error(`Rust workspace membership missing: ${role.name}`);
    if (fs.existsSync(path.join(rolePath, 'mops.toml')) && !mops.includes(role.name)) throw new Error(`Motoko project config missing: ${role.name}`);
  }
}
const external = new Set(manifest.external_boundaries);
for (const value of ['payments', 'secrets', 'vault_secret_management', 'vetkeys_or_protected_pii_boundary', 'existing_supabase_workloads']) if (!external.has(value)) throw new Error(`Missing external boundary: ${value}`);
console.log(`Topology valid: ${manifest.roles.length} logical roles, ${external.size} external boundaries.`);
