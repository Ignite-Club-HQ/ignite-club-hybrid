import { withFeatureBackend, type FeatureBackendContext } from '@/live/featureRouter';
import { writeOnce } from '@/live/clubScope';

export interface SharedBoardSnapshot {
  revision: bigint;
  pitch: Record<string, unknown>;
}

async function owner(ctx: FeatureBackendContext, teamId: string) {
  const { getLiveTeam } = await import('@/live/features/club');
  const [team] = await getLiveTeam(ctx, teamId);
  if (!team?.club_id) throw new Error('Pitch board has no club scope');
  return team.club_id;
}

export async function readSharedPitchBoard(teamId: string): Promise<SharedBoardSnapshot | null> {
  return withFeatureBackend('events', {
    supabase: async () => { throw new Error('ICP board required'); },
    icp: async ctx => {
      const { readLiveSharedBoard } = await import('@/live/features/events');
      return readLiveSharedBoard(ctx, await owner(ctx, teamId), teamId);
    },
  }, { teamId });
}

export async function writeSharedPitchBoard(teamId: string, revision: bigint | null, pitch: Record<string, unknown>, session: string) {
  return withFeatureBackend('events', {
    supabase: async () => { throw new Error('ICP board required'); },
    icp: async ctx => {
      const { writeLiveSharedBoard } = await import('@/live/features/events');
      return writeLiveSharedBoard(ctx, await owner(ctx, teamId), teamId, revision, pitch, session);
    },
  }, writeOnce({ teamId }));
}

/** Device-only metadata is excluded, so polling hydration cannot echo itself. */
export function sharedPitchSignature(pitch: Record<string, unknown>) {
  const { lastUpdateTime: _time, lastTimerSeconds: _seconds, teamId: _team, ...state } = pitch;
  return JSON.stringify(state);
}