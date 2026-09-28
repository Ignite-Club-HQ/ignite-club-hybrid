import { Principal } from '@icp-sdk/core/principal';
import { describe, expect, test, vi } from 'vitest';
import {
  createHybridTargetedAttendanceRepository,
  fetchTargetedAttendanceRoster,
  mergeTargetedChildren,
  selectScopedChildRoster,
  selectTargetedReminderMembers,
  type ScopedAttendanceRosterRow,
  type TargetedAttendanceProvider,
} from '../src/lab/hybridTargetedAttendanceRepository';
import { createSyntheticPlacementRegistry } from '../src/lab/syntheticPlacementRegistry';

const CLUB_A = 'club-targeted-a';
const CLUB_B = 'club-targeted-b';
const EVENT_A = 'event-targeted-a';
const ICP_A = Principal.fromText('aaaaa-aa');
const ICP_B = Principal.fromText('2vxsx-fae');

const childRow = (overrides: Partial<ScopedAttendanceRosterRow> = {}): ScopedAttendanceRosterRow => ({
  kind: 'child',
  person_id: 'child-1',
  display_name: 'Child One',
  parent_id: 'parent-1',
  team_ids: ['team-1'],
  ...overrides,
});

function makeProvider(options: {
  rows?: ScopedAttendanceRosterRow[];
  error?: unknown;
} = {}): TargetedAttendanceProvider {
  return {
    listTargetedAttendanceRoster: vi.fn(async () => {
      if (options.error) throw options.error;
      return options.rows ?? [];
    }),
  };
}

describe('targeted attendance roster read adaptation', () => {
  test('reads the exact event roster from the routed provider', async () => {
    const rows = [childRow()];
    const provider = makeProvider({ rows });

    await expect(fetchTargetedAttendanceRoster(provider, EVENT_A)).resolves.toBe(rows);
    expect(provider.listTargetedAttendanceRoster).toHaveBeenCalledWith(EVENT_A);
  });

  test('propagates an authoritative roster read failure rather than an empty roster', async () => {
    const denied = { code: '42501', message: 'denied' };

    await expect(fetchTargetedAttendanceRoster(makeProvider({ error: denied }), EVENT_A))
      .rejects.toBe(denied);
  });
});

describe('targeted child composition', () => {
  test('keeps only child rows from a mixed scoped roster', () => {
    const child = childRow();
    expect(selectScopedChildRoster([
      child,
      { ...child, kind: 'adult', person_id: 'adult-1' },
    ])).toEqual([child]);
  });

  test('merges RLS-visible and scoped children once without mutating input', () => {
    const visible = [{ id: 'child-1', name: null, parent_id: 'parent-1', local: true }];
    const merged = mergeTargetedChildren(visible, [
      childRow(),
      childRow({ person_id: 'child-2', display_name: 'Child Two', parent_id: 'parent-2' }),
      childRow({ person_id: 'child-2', display_name: 'Duplicate', parent_id: 'parent-2' }),
    ]);
    expect(merged).toEqual([
      { id: 'child-1', name: 'Child One', parent_id: 'parent-1', local: true },
      { id: 'child-2', name: 'Child Two', parent_id: 'parent-2' },
    ]);
    expect(visible[0].name).toBeNull();
  });

  test('preserves an existing visible child name over scoped fallback data', () => {
    expect(mergeTargetedChildren(
      [{ id: 'child-1', name: 'Preferred Name', parent_id: 'parent-1' }],
      [childRow({ display_name: 'Fallback Name' })],
    )[0].name).toBe('Preferred Name');
  });
});

describe('targeted reminder audience composition', () => {
  const members = [
    { id: 'target-adult', role_team_pairs: [{ role: 'player', team_id: 'team-1' }] },
    { id: 'other-team', role_team_pairs: [{ role: 'player', team_id: 'team-9' }] },
    { id: 'primary-parent', role_team_pairs: [] },
    { id: 'guardian', role_team_pairs: [] },
    { id: 'unlinked-official', role_team_pairs: [{ role: 'committee_member', team_id: null }] },
  ];

  test('includes targeted-team adults plus linked parents and guardians only', () => {
    const selected = selectTargetedReminderMembers(
      members,
      ['team-1', 'team-2'],
      [{ id: 'child-1', parent_id: 'primary-parent' }],
      [{ child_id: 'child-1', guardian_id: 'guardian' }],
    );
    expect(selected.map(member => member.id)).toEqual([
      'target-adult', 'primary-parent', 'guardian',
    ]);
  });

  test('excludes unrelated teams and unlinked club officials', () => {
    const selected = selectTargetedReminderMembers(members, ['team-1'], [], []);
    expect(selected.map(member => member.id)).toEqual(['target-adult']);
  });

  test('does not duplicate a multi-role or parent-and-team member', () => {
    const selected = selectTargetedReminderMembers(
      [{
        id: 'multi',
        role_team_pairs: [
          { role: 'coach', team_id: 'team-1' },
          { role: 'player', team_id: 'team-2' },
        ],
      }],
      ['team-1', 'team-2'],
      [{ id: 'child-1', parent_id: 'multi' }],
      [{ child_id: 'child-1', guardian_id: 'multi' }],
    );
    expect(selected).toHaveLength(1);
  });
});

for (const mode of ['supabase', 'icp'] as const) {
  test(`routes the targeted roster through explicit ${mode} provider and reuses it`, async () => {
    const registry = createSyntheticPlacementRegistry([{
      clubId: CLUB_A,
      country: 'AU',
      backend: mode === 'supabase'
        ? { Supabase: { environment: 'targeted-attendance-au' } }
        : { Icp: { canister: ICP_A } },
    }]);
    const provider = makeProvider({ rows: [childRow()] });
    const providerCalls: string[] = [];
    const repository = createHybridTargetedAttendanceRepository(registry, {
      supabase: async environment => {
        providerCalls.push(`supabase:${environment}`);
        return provider;
      },
      icp: async canister => {
        providerCalls.push(`icp:${canister.toText()}`);
        return provider;
      },
    });

    const roster = await repository.fetchRoster(CLUB_A, EVENT_A);
    await repository.fetchRoster(CLUB_A, EVENT_A);

    expect(roster).toEqual([childRow()]);
    expect(providerCalls).toEqual([
      mode === 'supabase' ? 'supabase:targeted-attendance-au' : `icp:${ICP_A.toText()}`,
    ]);
    expect(provider.listTargetedAttendanceRoster).toHaveBeenCalledTimes(2);
    expect(provider.listTargetedAttendanceRoster).toHaveBeenCalledWith(EVENT_A);
  });
}

test('keeps the targeted roster isolated across clubs on different backend placements', async () => {
  const registry = createSyntheticPlacementRegistry([
    { clubId: CLUB_A, country: 'AU', backend: { Supabase: { environment: 'targeted-attendance-au' } } },
    { clubId: CLUB_B, country: 'AU', backend: { Icp: { canister: ICP_B } } },
  ]);
  const repository = createHybridTargetedAttendanceRepository(registry, {
    supabase: async () => makeProvider({ rows: [childRow({ person_id: 'supabase-child' })] }),
    icp: async () => makeProvider({ rows: [childRow({ person_id: 'icp-child' })] }),
  });

  await expect(repository.fetchRoster(CLUB_A, EVENT_A)).resolves.toEqual([
    expect.objectContaining({ person_id: 'supabase-child' }),
  ]);
  await expect(repository.fetchRoster(CLUB_B, EVENT_A)).resolves.toEqual([
    expect.objectContaining({ person_id: 'icp-child' }),
  ]);
});

test('does not fall back to Supabase when the selected ICP provider fails', async () => {
  let supabaseCalls = 0;
  const registry = createSyntheticPlacementRegistry([{
    clubId: CLUB_A,
    country: 'AU',
    backend: { Icp: { canister: ICP_A } },
  }]);
  const repository = createHybridTargetedAttendanceRepository(registry, {
    supabase: async () => {
      supabaseCalls += 1;
      throw new Error('Supabase must not be used in ICP mode');
    },
    icp: async () => {
      throw new Error('local ICP targeted attendance provider unavailable');
    },
  });

  await expect(repository.fetchRoster(CLUB_A, EVENT_A))
    .rejects.toThrow('local ICP targeted attendance provider unavailable');
  expect(supabaseCalls).toBe(0);
});

test('surfaces an unavailable backend placement with no fallback', async () => {
  let supabaseCalls = 0;
  const registry = createSyntheticPlacementRegistry([{
    clubId: CLUB_A,
    country: 'AU',
    backend: { Icp: { canister: ICP_A } },
  }]);
  registry.setAvailability('icp', false);
  const repository = createHybridTargetedAttendanceRepository(registry, {
    supabase: async () => {
      supabaseCalls += 1;
      throw new Error('Supabase must not be used in ICP mode');
    },
    icp: async () => makeProvider({ rows: [childRow({ person_id: 'unreachable' })] }),
  });

  await expect(repository.fetchRoster(CLUB_A, EVENT_A)).rejects.toThrow(/Backend unavailable/);
  expect(supabaseCalls).toBe(0);
});
