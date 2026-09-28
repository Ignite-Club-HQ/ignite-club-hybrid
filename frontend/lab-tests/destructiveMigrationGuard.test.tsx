import { describe, expect, it } from 'vitest';

const DESTRUCTIVE_PATTERNS = [
  /\bdrop\s+table\b/i,
  /\bdrop\s+column\b/i,
  /\btruncate\b/i,
  /\bdelete\s+from\s+\w+\s*(;|$)/i,
];

function classifyMigrationStatement(statement: string) {
  const isDestructive = DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(statement));
  return isDestructive ? ('destructive' as const) : ('safe' as const);
}

function planMigration(statements: string[], confirmedDestructive: boolean) {
  const destructive = statements.filter((statement) => classifyMigrationStatement(statement) === 'destructive');
  if (destructive.length > 0 && !confirmedDestructive) {
    return { ok: false, reason: 'destructive-confirmation-required', destructive } as const;
  }
  return { ok: true, applied: statements } as const;
}

describe('destructive migration guard', () => {
  it('classifies drop/truncate/unconditional-delete statements as destructive', () => {
    expect(classifyMigrationStatement('DROP TABLE clubs;')).toBe('destructive');
    expect(classifyMigrationStatement('ALTER TABLE clubs DROP COLUMN legacy_id;')).toBe('destructive');
    expect(classifyMigrationStatement('TRUNCATE clubs;')).toBe('destructive');
    expect(classifyMigrationStatement('DELETE FROM clubs;')).toBe('destructive');
    expect(classifyMigrationStatement('DELETE FROM clubs WHERE id = $1;')).toBe('safe');
    expect(classifyMigrationStatement('ALTER TABLE clubs ADD COLUMN nickname text;')).toBe('safe');
  });

  it('blocks a migration plan containing an unconfirmed destructive statement', () => {
    const statements = ['ALTER TABLE clubs ADD COLUMN nickname text;', 'DROP TABLE legacy_clubs;'];

    expect(planMigration(statements, false)).toEqual({
      ok: false,
      reason: 'destructive-confirmation-required',
      destructive: ['DROP TABLE legacy_clubs;'],
    });
    expect(planMigration(statements, true)).toEqual({ ok: true, applied: statements });
    expect(planMigration(['ALTER TABLE clubs ADD COLUMN nickname text;'], false)).toEqual({
      ok: true,
      applied: ['ALTER TABLE clubs ADD COLUMN nickname text;'],
    });
  });
});
