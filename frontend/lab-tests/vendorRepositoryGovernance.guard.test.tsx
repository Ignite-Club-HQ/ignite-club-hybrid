import { describe, expect, it } from 'vitest';

type VendorPackage = { name: string; version: string; approved: boolean };

function evaluateVendorGovernance(packages: VendorPackage[], allowlist: string[]) {
  const disallowed = packages.filter((pkg) => !allowlist.includes(pkg.name) || !pkg.approved);
  return {
    ok: disallowed.length === 0,
    disallowed: disallowed.map((pkg) => pkg.name),
  };
}

describe('vendor repository governance guard', () => {
  it('blocks unapproved or untrusted vendor packages and keeps the allowlist authoritative', () => {
    const packages: VendorPackage[] = [
      { name: '@acme/ui', version: '2.0.0', approved: true },
      { name: '@third-party/unsafe', version: '1.0.0', approved: false },
    ];

    expect(evaluateVendorGovernance(packages, ['@acme/ui'])).toEqual({
      ok: false,
      disallowed: ['@third-party/unsafe'],
    });
  });
});
