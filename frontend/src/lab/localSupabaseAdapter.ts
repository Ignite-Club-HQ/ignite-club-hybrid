import { createFixtureClubLinksService } from './clubLinksService.mjs';
import type { ClubLinksService } from './ClubLinksService';

export type LocalSupabaseLifecycle = 'Active' | 'ReadOnly' | 'MigrationRequired' | 'Blocked';

type LocalProviderService = ClubLinksService & {
  dispose(): void;
  state(): LocalSupabaseLifecycle;
};

export function createLocalSupabaseProvider(options: {
  environments: readonly string[];
  clubIdForEnvironment?: (environment: string) => string;
}): ((environment: string) => Promise<LocalProviderService>) & {
  setState(environment: string, state: LocalSupabaseLifecycle): void;
} {
  const allowed = new Set(options.environments);
  const services = new Map<string, LocalProviderService>();
  const states = new Map<string, LocalSupabaseLifecycle>();
  const requireEnvironment = (environment: string) => {
    if (!allowed.has(environment)) throw new Error(`Local Supabase environment is not allowlisted: ${environment}`);
  };
  const getState = (environment: string) => states.get(environment) ?? 'Active';
  const check = (environment: string, write: boolean) => {
    const state = getState(environment);
    if (state === 'Blocked') throw new Error(`Local Supabase environment is blocked: ${environment}`);
    if (write && state !== 'Active') {
      const label = state === 'ReadOnly' ? 'read-only' : 'migration required';
      throw new Error(`Local Supabase environment is ${label}: ${environment}`);
    }
  };
  const provider = async (environment: string): Promise<LocalProviderService> => {
    requireEnvironment(environment);
    let service = services.get(environment);
    if (service) return service;
    const fixture = createFixtureClubLinksService({ clubId: options.clubIdForEnvironment?.(environment) });
    let disposed = false;
    const live = () => { if (disposed) throw new Error('Identity changed; operation discarded'); };
    service = {
      listAdmin: async club => { live(); check(environment, false); return fixture.listAdmin(club); },
      listVisible: async club => { live(); check(environment, false); return fixture.listVisible(club); },
      get: async id => { live(); check(environment, false); return fixture.get(id); },
      save: async (club, draft) => { live(); check(environment, true); return fixture.save(club, draft); },
      remove: async id => { live(); check(environment, true); return fixture.remove(id); },
      setActive: async (id, active) => { live(); check(environment, true); return fixture.setActive(id, active); },
      reorder: async (club, first, second) => { live(); check(environment, true); return fixture.reorder(club, first, second); },
      dispose: () => { disposed = true; },
      state: () => getState(environment),
    };
    services.set(environment, service);
    return service;
  };
  provider.setState = (environment: string, state: LocalSupabaseLifecycle) => {
    requireEnvironment(environment);
    states.set(environment, state);
  };
  return provider;
}