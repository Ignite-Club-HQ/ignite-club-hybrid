import { createFixtureClubLinksService } from './clubLinksService.mjs';
import type { ClubLinksService } from './ClubLinksService';

/**
 * Synthetic Supabase-shaped provider for hybrid adapter tests only.
 * It is intentionally in-memory and has no Supabase client, URL, credentials,
 * network access, or production fallback.
 */
export function createSyntheticSupabaseProvider(options: { clubIdForEnvironment?: (environment: string) => string } = {}): (environment: string) => Promise<ClubLinksService & { dispose(): void }> {
  const services = new Map<string, ClubLinksService & { dispose(): void }>();
  return async (environment: string) => {
    let service = services.get(environment);
    if (!service) {
      const fixture = createFixtureClubLinksService({ clubId: options.clubIdForEnvironment?.(environment) }) as ClubLinksService;
      service = { ...fixture, dispose: () => undefined };
      services.set(environment, service);
    }
    return service;
  };
}
