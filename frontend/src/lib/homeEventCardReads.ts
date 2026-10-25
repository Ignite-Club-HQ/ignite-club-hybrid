import { supabase } from '@/integrations/supabase/client';
import { withFeatureBackend } from '@/live/featureRouter';

const account = (id: string) => id.replace(/^principal:/, '');

export async function readHomeCardRsvp(eventId: string, userId: string) {
  return withFeatureBackend('events', {
    supabase: async () => {
      const { data, error } = await supabase.from('rsvps').select('id, status')
        .eq('event_id', eventId).eq('user_id', userId).is('child_id', null).maybeSingle();
      if (error) throw error;
      return data;
    },
    icp: async ctx => {
      const { listLiveMyRsvps } = await import('@/live/features/events');
      const rows = await listLiveMyRsvps(ctx);
      const row = rows.find(r => r.event_id === eventId && !r.child_id.length && account(r.account_id) === account(userId));
      return row ? { id: `${eventId}:${row.account_id}`, status: row.state } : null;
    },
  }, { eventId });
}

export async function readHomeCardDuties(eventId: string, userId: string) {
  return withFeatureBackend('events', {
    supabase: async () => {
      const { data, error } = await supabase.from('duties').select('id, name, start_time, end_time, status')
        .eq('event_id', eventId).eq('assigned_to', userId);
      if (error) throw error;
      return data ?? [];
    },
    icp: async ctx => {
      const { listLiveDuties } = await import('@/live/features/events');
      return (await listLiveDuties(ctx, eventId)).filter(d => account(d.account_id) === account(userId))
        .map(d => ({ id: `${eventId}:${d.account_id}:${d.duty}`, name: d.duty,
          start_time: null, end_time: null, status: d.completed ? 'completed' : 'assigned' }));
    },
  }, { eventId });
}

export async function readHomeCardIcpSummary(eventId: string, social: boolean) {
  return withFeatureBackend('events', {
    supabase: async () => { throw new Error('ICP attendance read required'); },
    icp: async ctx => {
      const { getLiveEventRosterDetailed } = await import('@/live/features/events');
      const roster = await getLiveEventRosterDetailed(ctx, eventId);
      const going = roster.rsvps.filter(r => r.rsvp.state === 'going' && (social || r.rsvp.child_id.length > 0));
      return { totalCount: going.length, avatars: going.slice(0, 5).map(r => ({
        id: `${eventId}:${r.rsvp.account_id}:${r.rsvp.child_id[0] ?? ''}`,
        displayName: r.rsvp.child_id.length ? 'Child' : 'Member', avatarUrl: null,
      })) };
    },
  }, { eventId });
}