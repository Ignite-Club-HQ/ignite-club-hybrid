// Fail closed for every unported caller. No SDK, endpoint, token or auth storage.
// The local web shell gets a signed-out auth response so the real Ignite UI can
// render its auth screen without turning an unavailable backend into a blank page.
// In lab mode with ICP auth, return synthetic fixture data for core queries so pages render.

import { resolveLocalAuthMode } from '../../lab/localRuntimeMode';

function isCoreLabQuery(table: string): boolean {
	return ['clubs', 'teams', 'events', 'team_memberships', 'club_members'].includes(table);
}

async function getFixtureData(table: string, filters: Record<string, any> = {}) {
	const useIcp = resolveLocalAuthMode(typeof window !== 'undefined' ? window.location.search : '', true);
	if (!useIcp) return null;

	// Fixture data is only needed in ICP lab mode; load it lazily so its ~17KB
	// of synthetic data never enters the initial chunk for the common
	// (non-ICP) path.
	const fixtures = await import('../../lab/fixtureDataLayer');

	// Return synthetic data for core queries
	if (table === 'clubs') {
		if (filters.eq?.id) return fixtures.getFixtureClubDetail(filters.eq.id);
		if (filters.in?.id) return fixtures.getFixtureUserClubs('icp-member').filter(c => filters.in.id.includes(c.id));
		return fixtures.getFixtureUserClubs('icp-member');
	}
	if (table === 'teams') {
		if (filters.eq?.id) return fixtures.getFixtureTeamDetail(filters.eq.id);
		if (filters.in?.id) return fixtures.getFixtureUserTeams('icp-member').filter(t => filters.in.id.includes(t.id));
		return fixtures.getFixtureUserTeams('icp-member');
	}
	if (table === 'events') {
		return fixtures.getFixtureUpcomingEvents('icp-member');
	}
	return null;
}

const disabled = () => { throw new Error('Supabase is disabled in ignite-icp-lab. Port this feature to a local service.'); };
const localAuth = {
	async getSession() { return { data: { session: null }, error: null }; },
	onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
	async signOut() { return { error: null }; },
	async signUp() { return { data: { user: null, session: null }, error: new Error('Authentication is not connected in the local ICP shell.') }; },
	async signInWithPassword() { return { data: { user: null, session: null }, error: new Error('Authentication is not connected in the local ICP shell.') }; },
	async signInWithOAuth() { return { data: { provider: null, url: null }, error: new Error('Authentication is not connected in the local ICP shell.') }; },
};

// Mock query builder for core lab queries
class MockQueryBuilder {
	private table: string;
	private filters: Record<string, any> = {};
	private selectCols: string = '*';

	constructor(table: string) {
		this.table = table;
	}

	select(cols: string = '*') {
		this.selectCols = cols;
		return this;
	}

	eq(col: string, val: any) {
		this.filters.eq = { ...this.filters.eq, [col]: val };
		return this;
	}

	in(col: string, vals: any[]) {
		this.filters.in = { ...this.filters.in, [col]: vals };
		return this;
	}

	is(col: string, val: any) {
		// is() is usually for null checks; fixture data doesn't support this yet
		return this;
	}

	not(col: string, op: string, val: any) {
		// not() filters; fixture data doesn't support this yet
		return this;
	}

	gte(col: string, val: any) {
		// Comparison filters; fixture data doesn't support this yet
		return this;
	}

	order(col: string, opts: any = {}) {
		return this;
	}

	maybeSingle() {
		return this.maybeSingleImpl();
	}

	single() {
		return this.singleImpl();
	}

	private async maybeSingleImpl() {
		const data = await getFixtureData(this.table, this.filters);
		if (Array.isArray(data) && data.length > 0) {
			return { data: data[0], error: null };
		}
		if (!Array.isArray(data) && data !== null) {
			return { data, error: null };
		}
		return { data: null, error: null };
	}

	private async singleImpl() {
		const { data, error } = await this.maybeSingleImpl();
		if (!data) {
			return { data: null, error: new Error('No rows found') };
		}
		return { data, error };
	}

	async then(resolve: any, reject: any) {
		const data = await getFixtureData(this.table, this.filters);
		if (Array.isArray(data)) {
			resolve({ data, error: null });
		} else if (data !== null) {
			resolve({ data: [data], error: null });
		} else {
			resolve({ data: [], error: null });
		}
	}
}

export const supabase: any = new Proxy(disabled, {
	get(_target, property) {
		if (property === 'auth') return localAuth;
		if (property === 'from') {
			return (table: string) => new MockQueryBuilder(table);
		}
		if (property === 'rpc') {
			// RPC calls return empty/no-op responses in lab mode
			return () => Promise.resolve({ data: null, error: null });
		}
		return disabled;
	},
	apply: disabled,
});
