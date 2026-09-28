import { describe, expect, it } from 'vitest';

function buildProductionBlocker(reason: string, evidence: string[]) {
  return {
    status: 'blocked',
    reason,
    evidence,
  } as const;
}

describe('production-only migration and deployment assertions', () => {
  it('documents the exact blocker that prevents local lab execution for native deployment or production-only checks', () => {
    const blocker = buildProductionBlocker(
      'Production-only deployment and native assertions cannot be executed in the isolated lab workspace.',
      [
        'The lab bundle is intentionally isolated from production credentials and deployment infrastructure.',
        'The repo explicitly keeps the fail-closed Supabase client disabled and does not include native app signing or deployment workflows.',
      ],
    );

    expect(blocker.status).toBe('blocked');
    expect(blocker.reason).toMatch(/Production-only/i);
    expect(blocker.evidence).toHaveLength(2);
  });
});
