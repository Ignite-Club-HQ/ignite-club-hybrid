import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const pagesDir = path.join(root, 'src/pages');
const validStatuses = new Set(['hybrid', 'supabase_only', 'external_boundary', 'not_enabled']);
const validBehaviors = new Set(['fixture_read_only', 'icp_service_read', 'icp_service_write', 'unavailable']);

function pageFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return pageFiles(full);
    if (!entry.name.endsWith('.tsx') || /\.(test|spec)\.tsx$/.test(entry.name)) return [];
    const text = fs.readFileSync(full, 'utf8');
    return text.includes('integrations/supabase/client')
      ? [path.relative(root, full).replaceAll(path.sep, '/')]
      : [];
  });
}

const inventory = JSON.parse(fs.readFileSync(path.join(root, 'lab-route-classification.json'), 'utf8'));
assert(Array.isArray(inventory), 'Route classification inventory must be an array');

const inventoryPaths = inventory.map(item => item.path);
const duplicate = inventoryPaths.find((item, index) => inventoryPaths.indexOf(item) !== index);
assert(!duplicate, `Duplicate route classification for ${duplicate}`);

for (const item of inventory) {
  assert.equal(typeof item.path, 'string', 'Route classification path must be a string');
  assert(validStatuses.has(item.status), `Invalid status for ${item.path}`);
  assert(validBehaviors.has(item.icpBehavior), `Invalid ICP behavior for ${item.path}`);
  assert.equal(typeof item.nextDependency, 'string', `Missing next dependency for ${item.path}`);
}

const directSupabasePages = pageFiles(pagesDir).sort();
assert.deepEqual(inventoryPaths.slice().sort(), directSupabasePages);

const hybridBoundaryMarkers = [
  'resolveLocalAuthMode',
  'useHybridQuery',
  '/lab/hybrid',
  '/lab/local',
  'IcpLab',
];
for (const item of inventory.filter(entry => entry.status === 'hybrid')) {
  const source = fs.readFileSync(path.join(root, item.path), 'utf8');
  assert(
    hybridBoundaryMarkers.some(marker => source.includes(marker)),
    `Hybrid route has no explicit ICP/provider boundary: ${item.path}`,
  );
}

const counts = inventory.reduce((acc, item) => {
  acc[item.status] = (acc[item.status] ?? 0) + 1;
  return acc;
}, {});
console.log(`Route classification inventory passed: ${inventory.length} pages`, counts);
