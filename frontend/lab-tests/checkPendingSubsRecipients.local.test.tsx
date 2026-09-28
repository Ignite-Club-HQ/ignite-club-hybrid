/**
 * Local equivalent of the exported `checkPendingSubs.recipients.test.ts`
 * suite, exercising the ported `getTeamStaffUserIds` recipient-policy
 * helper against a synthetic in-memory query fake.
 */
import { describe, expect, it, vi } from 'vitest';
import { getTeamStaffUserIds } from '../src/lab/edgeGuards/checkPendingSubsRecipients';

type Row = Record<string, any>;
class Query {
  private filters: Array<['eq' | 'in' | 'not', string, any, any?]> = [];
  constructor(private rows: Row[]) {}
  select() {
    return this;
  }
  eq(column: string, value: any) {
    this.filters.push(['eq', column, value]);
    return this;
  }
  in(column: string, values: any[]) {
    this.filters.push(['in', column, values]);
    return this;
  }
  not(column: string, operator: string, value: any) {
    this.filters.push(['not', column, operator, value]);
    return this;
  }
  private result() {
    return this.rows.filter((row) =>
      this.filters.every(([kind, column, value]) => {
        if (kind === 'eq') return row[column] === value;
        if (kind === 'in') return value.includes(row[column]);
        return value === 'is' ? row[column] !== null : true;
      }),
    );
  }
  maybeSingle() {
    return Promise.resolve({ data: this.result()[0] ?? null, error: null });
  }
  then(resolve: (value: any) => void) {
    return Promise.resolve({ data: this.result(), error: null }).then(resolve);
  }
}

function database(tables: Record<string, Row[]>) {
  const queried: string[] = [];
  return {
    queried,
    client: {
      from: vi.fn((table: string) => {
        queried.push(table);
        return new Query(tables[table] ?? []);
      }),
    },
  };
}

describe('check-pending-subs recipient isolation', () => {
  it('notifies only coach/team-admin roles on the exact team plus exact-event duties', async () => {
    const db = database({
      team_subscriptions: [
        {
          team_id: 'team-a',
          pitch_notify_coach: true,
          pitch_notify_team_admin: true,
          pitch_notify_subs_manager: true,
        },
      ],
      user_roles: [
        { user_id: 'coach-a', team_id: 'team-a', role: 'coach' },
        { user_id: 'admin-a', team_id: 'team-a', role: 'team_admin' },
        { user_id: 'player-a', team_id: 'team-a', role: 'player' },
        { user_id: 'coach-b', team_id: 'team-b', role: 'coach' },
        { user_id: 'club-admin', team_id: null, role: 'club_admin' },
      ],
      duties: [
        { assigned_to: 'manager-a', event_id: 'event-a', name: 'Subs Manager' },
        { assigned_to: 'ref-a', event_id: 'event-a', name: 'Referee' },
        { assigned_to: 'manager-b', event_id: 'event-b', name: 'Subs Manager' },
      ],
    });
    await expect(getTeamStaffUserIds(db.client, 'team-a', 'event-a')).resolves.toEqual(
      expect.arrayContaining(['coach-a', 'admin-a', 'manager-a', 'ref-a']),
    );
    const recipients = await getTeamStaffUserIds(db.client, 'team-a', 'event-a');
    expect(recipients.sort()).toEqual(['admin-a', 'coach-a', 'manager-a', 'ref-a']);
  });

  it('honours each role toggle while Referee remains enabled', async () => {
    const db = database({
      team_subscriptions: [
        {
          team_id: 'team-a',
          pitch_notify_coach: false,
          pitch_notify_team_admin: true,
          pitch_notify_subs_manager: false,
        },
      ],
      user_roles: [
        { user_id: 'coach', team_id: 'team-a', role: 'coach' },
        { user_id: 'admin', team_id: 'team-a', role: 'team_admin' },
      ],
      duties: [
        { assigned_to: 'manager', event_id: 'event-a', name: 'Subs Manager' },
        { assigned_to: 'ref', event_id: 'event-a', name: 'Referee' },
      ],
    });
    await expect(getTeamStaffUserIds(db.client, 'team-a', 'event-a')).resolves.toEqual([
      'admin',
      'ref',
    ]);
  });

  it('deduplicates someone assigned through both a team role and match duty', async () => {
    const db = database({
      team_subscriptions: [{ team_id: 'team-a' }],
      user_roles: [{ user_id: 'same-person', team_id: 'team-a', role: 'coach' }],
      duties: [{ assigned_to: 'same-person', event_id: 'event-a', name: 'Subs Manager' }],
    });
    await expect(getTeamStaffUserIds(db.client, 'team-a', 'event-a')).resolves.toEqual([
      'same-person',
    ]);
  });

  it('mini-league notifications are limited to Referee/Subs Manager for one exact group', async () => {
    const db = database({
      event_group_duties: [
        { assigned_to: 'ref-this', group_id: 'group-a', name: 'Referee' },
        { assigned_to: 'manager-this', group_id: 'group-a', name: 'Subs Manager' },
        { assigned_to: 'scorer-this', group_id: 'group-a', name: 'Scorer' },
        { assigned_to: 'ref-other', group_id: 'group-b', name: 'Referee' },
      ],
      user_roles: [{ user_id: 'league-admin', team_id: null, role: 'league_admin' }],
    });
    const recipients = await getTeamStaffUserIds(db.client, 'event-group-group-a', 'event-a');
    expect(recipients.sort()).toEqual(['manager-this', 'ref-this']);
    expect(db.queried).toEqual(['event_group_duties']);
  });

  it('does not notify anyone when no scoped role or duty assignment exists', async () => {
    const db = database({
      team_subscriptions: [{ team_id: 'team-a' }],
      user_roles: [{ user_id: 'other-player', team_id: 'team-a', role: 'player' }],
      duties: [{ assigned_to: null, event_id: 'event-a', name: 'Referee' }],
    });
    await expect(getTeamStaffUserIds(db.client, 'team-a', 'event-a')).resolves.toEqual([]);
  });
});
