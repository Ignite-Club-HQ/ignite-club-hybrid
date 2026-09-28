import { describe, expect, it } from 'vitest';

type DependencyRecord = { name: string; version: string; vulnerable?: boolean };

function evaluateDependencySafety(records: DependencyRecord[], allowlist: string[]) {
  const blocked = records.filter((record) => record.vulnerable || !allowlist.includes(record.name));
  return {
    ok: blocked.length === 0,
    blocked,
  };
}

describe('remaining dependency security safety', () => {
  it('rejects any dependency that is explicitly marked vulnerable or not on the approved allowlist', () => {
    const records: DependencyRecord[] = [
      { name: 'react', version: '18.3.1', vulnerable: false },
      { name: 'lodash', version: '4.17.0', vulnerable: true },
      { name: 'unknown-lib', version: '0.0.1' },
    ];

    expect(evaluateDependencySafety(records, ['react'])).toEqual({
      ok: false,
      blocked: [
        { name: 'lodash', version: '4.17.0', vulnerable: true },
        { name: 'unknown-lib', version: '0.0.1' },
      ],
    });
  });
});
