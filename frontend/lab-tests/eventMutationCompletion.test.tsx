import { describe, expect, it } from 'vitest';

type EventMutationOutcome =
  | { status: 'rejected'; reason: 'stale-revision' | 'not-authorized' }
  | { status: 'applied'; revision: number; completionState: 'applied' };

function applyEventMutation(
  revision: number,
  submittedRevision: number | null,
  isAuthorized: boolean,
): EventMutationOutcome {
  if (!isAuthorized) {
    return { status: 'rejected', reason: 'not-authorized' };
  }
  if (submittedRevision !== null && submittedRevision !== revision) {
    return { status: 'rejected', reason: 'stale-revision' };
  }
  return { status: 'applied', revision: revision + 1, completionState: 'applied' };
}

describe('event mutation completion flow', () => {
  it('rejects stale revision submissions and only marks the mutation complete after an authorized apply', () => {
    expect(applyEventMutation(3, 2, true)).toMatchObject({ status: 'rejected', reason: 'stale-revision' });
    expect(applyEventMutation(3, 3, true)).toMatchObject({ status: 'applied', completionState: 'applied', revision: 4 });
    expect(applyEventMutation(3, null, false)).toMatchObject({ status: 'rejected', reason: 'not-authorized' });
  });
});
