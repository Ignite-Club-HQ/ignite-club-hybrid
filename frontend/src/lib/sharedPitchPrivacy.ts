/** Mask nested roster/substitution/goal names before shared state leaves a device. */
export function maskSharedPitchNames(pitch: Record<string, unknown>, prefix: string) {
  const names = new Map<string, string>();
  function walk(value: unknown, path: string): unknown {
    if (Array.isArray(value)) return value.map((item, index) => walk(item, `${path}:${index}`));
    if (!value || typeof value !== 'object') return value;
    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [field, child] of Object.entries(record)) {
      if (field === 'name' && typeof child === 'string' && child.trim()) {
        const ref = child.startsWith('pitch:') ? child : `${prefix}${typeof record.id === 'string' ? record.id : path}`;
        if (ref !== child) names.set(ref, child.trim());
        result[field] = ref;
      } else result[field] = walk(child, `${path}:${field}`);
    }
    return result;
  }
  return { pitch: walk(pitch, 'state') as Record<string, unknown>, names };
}

export function sharedPitchNameRefs(value: unknown): string[] {
  const refs = new Set<string>();
  function walk(item: unknown) {
    if (Array.isArray(item)) { item.forEach(walk); return; }
    if (!item || typeof item !== 'object') return;
    for (const [field, child] of Object.entries(item)) {
      if (field === 'name' && typeof child === 'string' && child.startsWith('pitch:')) refs.add(child);
      else walk(child);
    }
  }
  walk(value);
  return [...refs];
}

export function resolveSharedPitchNames(value: unknown, names: Map<string, string>): unknown {
  if (Array.isArray(value)) return value.map(item => resolveSharedPitchNames(item, names));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([field, child]) => [field,
    field === 'name' && typeof child === 'string' && child.startsWith('pitch:')
      ? names.get(child) ?? 'Player' : resolveSharedPitchNames(child, names)]));
}