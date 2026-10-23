import { describe, expect, it } from 'vitest';
import { IDL } from '@icp-sdk/core/candid';

describe('optional poll voter contract', () => {
  it('decodes older results without voter identities instead of failing the poll', () => {
    const vote = IDL.Record({ poll_id: IDL.Text, user: IDL.Principal, option_index: IDL.Nat32 });
    const oldResult = IDL.Record({ counts: IDL.Vec(IDL.Nat32), total_votes: IDL.Nat32 });
    const newResult = IDL.Record({ counts: IDL.Vec(IDL.Nat32), total_votes: IDL.Nat32, votes: IDL.Opt(IDL.Vec(vote)) });
    const wire = IDL.encode([oldResult], [{ counts: [1, 0], total_votes: 1 }]);
    const [decoded] = IDL.decode([newResult], wire) as [{ votes: unknown[]; total_votes: number }];
    expect(decoded.total_votes).toBe(1);
    expect(decoded.votes).toEqual([]);
  });
});