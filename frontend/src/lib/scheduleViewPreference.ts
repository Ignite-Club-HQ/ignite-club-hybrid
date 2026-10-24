import { withFeatureBackend } from '@/live/featureRouter';
import { writeOnce } from '@/live/clubScope';
import { connectLiveEventsDomain } from '@/live/domains';
import { unwrapCandid } from '@/live/features/candid';

export type ScheduleView = 'list' | 'calendar';
export async function getIcpScheduleView(): Promise<ScheduleView | null> {
  return withFeatureBackend('events', {
    supabase: async () => null,
    icp: async ctx => {
      const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
      const [view] = await actor.get_schedule_view();
      return view === 'list' || view === 'calendar' ? view : null;
    },
  }, { shared: 'person' });
}
export async function setIcpScheduleView(view: ScheduleView) {
  return withFeatureBackend('events', {
    supabase: async () => undefined,
    icp: async ctx => {
      const { actor } = await connectLiveEventsDomain(ctx.target, ctx.identity);
      await unwrapCandid(actor.set_schedule_view(view), 'Save schedule view');
    },
  }, writeOnce({ shared: 'person' }));
}