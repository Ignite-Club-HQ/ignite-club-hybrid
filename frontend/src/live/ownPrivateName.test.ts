import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fillOwnPrivateName, recallOwnPrivateName, rememberOwnPrivateName } from './ownPrivateName';
import { retirePrivateProfileSession } from './privateProfileSession';

/** Stand-in for the shared saved-name copies the app keeps while signed in. */
const saved = vi.hoisted(() => new Map<string, { display_name: string | null; avatar_url: string | null }>());

vi.mock('../lib/profileCache', () => ({
  getProfileFromCache: (id: string) => saved.get(id) ?? null,
  updateProfileCache: (profile: { id: string; display_name?: string | null; avatar_url?: string | null }) => {
    saved.set(profile.id, { display_name: profile.display_name ?? null, avatar_url: profile.avatar_url ?? null });
  },
}));
vi.mock('./features/identityAccessClient', () => ({
  accountIdForPrincipal: async (principal: string) =>
    principal === 'me-principal' ? 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' : null,
}));

beforeEach(() => { saved.clear(); });

describe('own private name', () => {
  it('shows my own saved name instead of my encrypted reference', () => {
    rememberOwnPrivateName('me-principal', 'Paul C');
    const rows = fillOwnPrivateName([
      { display_name: 'pii-display-name:v1:auth:me-principal' },
      { display_name: 'pii-display-name:v1:auth:someone-else' },
    ], 'me-principal');
    expect(rows[0].display_name).toBe('Paul C');
    expect(rows[1].display_name).toBe('pii-display-name:v1:auth:someone-else');
  });

  it('forgets the name when the signed-in session ends', () => {
    rememberOwnPrivateName('me-principal', 'Paul C');
    retirePrivateProfileSession();
    expect(recallOwnPrivateName('me-principal')).toBeUndefined();
  });

  it('replaces a blank saved copy of my own row with the unlocked name', async () => {
    saved.set('me-principal', { display_name: null, avatar_url: 'avatar-1' });
    saved.set('someone-else', { display_name: null, avatar_url: 'avatar-2' });
    rememberOwnPrivateName('me-principal', 'Paul C');
    await vi.waitFor(() => {
      expect(saved.get('me-principal')).toEqual({ display_name: 'Paul C', avatar_url: 'avatar-1' });
    });
    expect(saved.get('someone-else')).toEqual({ display_name: null, avatar_url: 'avatar-2' });
  });

  it('refreshes the same person under every saved id without inventing new rows', async () => {
    saved.set('principal:me-principal', { display_name: 'Old Name', avatar_url: null });
    saved.set('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', { display_name: null, avatar_url: 'avatar-3' });
    rememberOwnPrivateName('me-principal', 'Paul C');
    await vi.waitFor(() => {
      expect(saved.get('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')?.display_name).toBe('Paul C');
    });
    expect(saved.get('principal:me-principal')?.display_name).toBe('Paul C');
    expect(saved.has('me-principal')).toBe(false);
  });
});
