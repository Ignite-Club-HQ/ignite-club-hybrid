import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import ClubLinksManager from '@/components/clubs/ClubLinksManager';
import { Toaster } from '@/components/ui/toaster';
import { Bell, CalendarDays, ChevronDown, CircleHelp, Home, Link2, MessageSquare, ShieldCheck, Users } from 'lucide-react';
import { createFixtureClubLinksService, DEMO_CLUB_ID } from './clubLinksService.mjs';
import type { ClubLinksService } from './ClubLinksService';
import { connectLocalActor, connectLocalActorWithConfig } from './localActor';
import { createIcpClubLinksService } from './icpClubLinksService';
import { personas } from './syntheticIdentities.mjs';
import { createHybridClubLinksService } from './hybridClubLinksService';
import { createSyntheticPlacementRegistry } from './syntheticPlacementRegistry';
import { createSyntheticSupabaseProvider } from './syntheticSupabaseProvider';
import { Principal } from '@icp-sdk/core/principal';
import { PlacementAdminSettingsPanel } from './PlacementAdminSettingsPanel';
import { createPlacementAdminController } from './placementAdminSettings';
import { getForcedBackend } from './forcedBackend';

const HYBRID_CLUBS = { supabase: 'hybrid-au', icp: DEMO_CLUB_ID } as const;
const placementAdmin = createPlacementAdminController({
  countries: [
    { country: 'AU', allowedBackends: ['supabase'], policies: [{ backend: 'supabase', enabled: true, targetAlias: 'supabase-au-primary', version: 'v1' }, { backend: 'icp', enabled: false, targetAlias: 'icp-au-cloud-engine', version: 'v1' }] },
    { country: 'US', allowedBackends: ['icp', 'supabase'], policies: [{ backend: 'icp', enabled: true, targetAlias: 'icp-us-cloud-engine', version: 'v1' }, { backend: 'supabase', enabled: true, targetAlias: 'supabase-us-primary', version: 'v2' }] },
  ],
  clubs: [],
});

function MemberPreview({ service, clubId }: { service: ClubLinksService; clubId: string }) {
  const { data: links = [], error } = useQuery({ queryKey: ['club-quick-links', clubId], queryFn: () => service.listVisible(clubId), refetchInterval: 5000 });
  return <section className="rounded-lg border p-5"><h2 className="mb-3 text-xl font-semibold">Member view</h2>
    {error ? <p role="alert">Could not load member links: {error.message}</p> : links.length ? links.map(link => <div key={link.id} className="mb-2 rounded border p-3"><strong>{link.title}</strong><p>{link.subtitle}</p><p className="text-xs text-muted-foreground">{link.url}</p></div>) : <p className="text-muted-foreground">Visible links will appear here.</p>}
  </section>;
}
function Session({ mode, persona, clubId }: { mode: string; persona: string; clubId: string }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: 5000, gcTime: 0 } } }));
  const [services, setServices] = useState<{ editor: ClubLinksService; member: ClubLinksService } | null>(() => {
    if (mode === 'fixture') { const fixture = createFixtureClubLinksService({ clubId }); return { editor: fixture, member: fixture }; }
    if (mode === 'hybrid' || mode === 'supabase') return null;
    return null;
  });
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let dispose: (() => void)[] = [];
    if (mode === 'hybrid') {
      Promise.all([connectLocalActorWithConfig(persona), connectLocalActorWithConfig('member')]).then(([editorConnection, memberConnection]) => {
        const registry = createSyntheticPlacementRegistry([
          { clubId: HYBRID_CLUBS.supabase, country: 'AU', backend: { Supabase: { environment: 'synthetic-au' } } },
          { clubId: HYBRID_CLUBS.icp, country: 'US', backend: { Icp: { canister: editorConnection.canisterId } } },
        ]);
        const supabase = createSyntheticSupabaseProvider({ clubIdForEnvironment: () => HYBRID_CLUBS.supabase });
        const providersFor = (actor: Awaited<ReturnType<typeof connectLocalActor>>) => ({
          supabase,
          icp: async (canister: Principal) => {
            if (canister.toText() !== editorConnection.canisterId.toText()) throw new Error('Configured ICP canister is unavailable');
            return createIcpClubLinksService(actor);
          },
        });
        const editor = createHybridClubLinksService(registry, providersFor(editorConnection.actor));
        const member = createHybridClubLinksService(registry, providersFor(memberConnection.actor));
        if (active) { dispose = [editor.dispose, member.dispose]; setServices({ editor, member }); }
        else { editor.dispose(); member.dispose(); }
      }).catch(e => { if (active) setError(e.message); });
    } else if (mode === 'icp') {
      Promise.all([connectLocalActor(persona), connectLocalActor('member')]).then(([a,b]) => {
        if (!active) return;
        const editor = createIcpClubLinksService(a), member = createIcpClubLinksService(b);
        dispose = [editor.dispose, member.dispose]; setServices({ editor, member });
      }).catch(e => { if (active) setError(e.message); });
    } else if (mode === 'supabase') {
      // Standalone synthetic-Supabase-only environment: no local actor
      // connection is ever opened, so this mode has zero ICP dependency.
      // It shares the same in-memory synthetic provider as the hybrid
      // AU placement, but here it is the sole and permanent backend for
      // the whole session, not a routed choice.
      const provider = createSyntheticSupabaseProvider({ clubIdForEnvironment: () => clubId });
      provider('standalone-supabase').then(service => {
        if (!active) { service.dispose(); return; }
        dispose = [service.dispose]; setServices({ editor: service, member: service });
      }).catch(e => { if (active) setError(e.message); });
    }
    return () => { active = false; dispose.forEach(f => f()); client.clear(); };
  }, [client, mode, persona]);
  if (error) return <p role="alert">{error} No fallback was used.</p>;
  if (!services) return <p>{mode === 'supabase' ? 'Connecting to the synthetic Supabase provider…' : 'Connecting to local ICP…'}</p>;
  return <QueryClientProvider client={client}>
    <ClubLinksManager clubId={clubId} service={services.editor} />
    <MemberPreview clubId={clubId} service={services.member} /><Toaster />
  </QueryClientProvider>;
}
export default function LabApp() {
  const forcedBackend = getForcedBackend();
  const [mode, setMode] = useState(() => forcedBackend ?? 'fixture');
  const [persona, setPersona] = useState(() => forcedBackend === 'icp' ? 'governor' : 'club_admin');
  const [hybridClub, setHybridClub] = useState<string>(HYBRID_CLUBS.supabase);
  const clubId = mode === 'hybrid' ? hybridClub : DEMO_CLUB_ID;
  const editorPersonas = forcedBackend === 'icp' ? personas : personas.filter(p => p !== 'governor');
  return <div className="min-h-screen bg-[#f5f7fb] text-slate-900">
    <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-5 lg:px-8">
      <div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#e34b36] text-sm font-black text-white">I</div><span className="text-lg font-bold tracking-tight">Ignite</span><span className="hidden text-sm text-slate-400 sm:inline">Club workspace</span></div>
      <div className="flex items-center gap-3"><button type="button" aria-label="Notifications" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><Bell className="h-5 w-5" /></button><div className="flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1.5"><div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#fbe1dc] text-xs font-bold text-[#bd3b2b]">CA</div><span className="hidden text-sm font-medium sm:inline">Club admin</span><ChevronDown className="h-4 w-4 text-slate-400" /></div></div>
    </header>
    <div className="mx-auto flex max-w-[1440px]">
      <aside className="hidden min-h-[calc(100vh-4rem)] w-60 shrink-0 border-r border-slate-200 bg-white p-4 lg:block"><div className="mb-8 px-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Workspace</div><nav className="space-y-1"><a className="flex items-center gap-3 rounded-lg bg-[#fff0ed] px-3 py-2.5 text-sm font-semibold text-[#c93f2e]" href="#home"><Home className="h-4 w-4" />Home</a><a className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-600 hover:bg-slate-50" href="#events"><CalendarDays className="h-4 w-4" />Events</a><a className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-600 hover:bg-slate-50" href="#teams"><Users className="h-4 w-4" />Teams</a><a className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-600 hover:bg-slate-50" href="#messages"><MessageSquare className="h-4 w-4" />Messages</a></nav><div className="mt-10 mb-3 px-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Manage</div><nav className="space-y-1"><a className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-600 hover:bg-slate-50" href="#links"><Link2 className="h-4 w-4" />Club links</a><a className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-600 hover:bg-slate-50" href="#settings"><ShieldCheck className="h-4 w-4" />Admin settings</a></nav><div className="mt-auto flex items-center gap-3 px-3 pt-16 text-sm text-slate-500"><CircleHelp className="h-4 w-4" />Help centre</div></aside>
      <main className="min-w-0 flex-1 p-5 sm:p-8"><div className="mx-auto max-w-6xl space-y-7"><section id="home" className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="mb-2 text-sm font-medium text-[#d34a36]">Tuesday, 14 September</p><h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Good morning, Club admin</h1><p className="mt-2 text-slate-500">Here’s what’s happening across your club today.</p></div><button type="button" className="flex w-fit items-center gap-2 rounded-lg bg-[#e34b36] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#cc402d]">Create event</button></section>
        <section className="grid gap-4 sm:grid-cols-3"><div className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-sm text-slate-500">Upcoming events</p><p className="mt-3 text-3xl font-bold">3</p><p className="mt-1 text-xs text-emerald-600">This week</p></div><div className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-sm text-slate-500">Active teams</p><p className="mt-3 text-3xl font-bold">8</p><p className="mt-1 text-xs text-slate-500">Across your club</p></div><div className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-sm text-slate-500">Unread messages</p><p className="mt-3 text-3xl font-bold">12</p><p className="mt-1 text-xs text-[#d34a36]">Needs attention</p></div></section>
        <section className="grid gap-6 xl:grid-cols-[1.4fr_1fr]"><div id="events" className="rounded-2xl border border-slate-200 bg-white p-5"><div className="mb-5 flex items-center justify-between"><div><h2 className="text-lg font-bold">Today at the club</h2><p className="mt-1 text-sm text-slate-500">Your next activities</p></div><button type="button" className="text-sm font-semibold text-[#d34a36]">View calendar</button></div><div className="space-y-3"><div className="flex items-center gap-4 rounded-xl bg-slate-50 p-4"><div className="w-14 text-center"><p className="text-xs font-semibold uppercase text-slate-400">SEP</p><p className="text-xl font-bold">14</p></div><div className="h-10 w-1 rounded-full bg-[#e34b36]"/><div><p className="font-semibold">U14 Premier training</p><p className="mt-1 text-sm text-slate-500">4:30 PM · North pitch · Under 14 Boys</p></div></div><div className="flex items-center gap-4 rounded-xl bg-slate-50 p-4"><div className="w-14 text-center"><p className="text-xs font-semibold uppercase text-slate-400">SEP</p><p className="text-xl font-bold">14</p></div><div className="h-10 w-1 rounded-full bg-[#f0b34b]"/><div><p className="font-semibold">Club committee meeting</p><p className="mt-1 text-sm text-slate-500">7:00 PM · Clubhouse meeting room</p></div></div></div></div><div id="messages" className="rounded-2xl border border-slate-200 bg-white p-5"><div className="mb-5 flex items-center justify-between"><div><h2 className="text-lg font-bold">Recent messages</h2><p className="mt-1 text-sm text-slate-500">Stay close to your teams</p></div><MessageSquare className="h-5 w-5 text-slate-400" /></div><div className="space-y-4"><div><div className="flex items-center justify-between"><p className="text-sm font-semibold">U14 Premier</p><span className="text-xs text-slate-400">9:42 AM</span></div><p className="mt-1 truncate text-sm text-slate-500">Reminder: training moved to the north pitch</p></div><div><div className="flex items-center justify-between"><p className="text-sm font-semibold">Club committee</p><span className="text-xs text-slate-400">Yesterday</span></div><p className="mt-1 truncate text-sm text-slate-500">Agenda for tonight’s meeting is ready</p></div></div></div></section>
        <section id="links" className="space-y-3"><div><h2 className="text-lg font-bold">Club information</h2><p className="mt-1 text-sm text-slate-500">Links your members use most.</p></div><div className="rounded-2xl border border-slate-200 bg-white p-1"><Session key={`${mode}:${persona}:${clubId}`} mode={mode} persona={persona} clubId={clubId} /></div></section>
        <details id="settings" className="rounded-2xl border border-dashed border-slate-300 bg-white p-5"><summary className="cursor-pointer text-sm font-semibold text-slate-700">Connection and staging controls</summary><div className="mt-4 space-y-4"><div className="flex flex-wrap gap-4"><label className="text-sm text-slate-600">Data source <select aria-label="Data source" className="ml-2 rounded-lg border border-slate-200 bg-white p-2" value={mode} disabled={forcedBackend !== null} onChange={e => setMode(e.target.value)}><option value="fixture">In-memory fixtures</option><option value="icp">Local ICP canister</option><option value="supabase">Standalone synthetic Supabase</option><option value="hybrid">Hybrid local ICP and synthetic Supabase</option></select></label>{mode === 'icp' && <label className="text-sm text-slate-600">Editor identity <select aria-label="Synthetic editor identity" className="ml-2 rounded-lg border border-slate-200 bg-white p-2" value={persona} onChange={e => setPersona(e.target.value)}>{editorPersonas.map(p => <option key={p}>{p}</option>)}</select></label>}{mode === 'hybrid' && <label className="text-sm text-slate-600">Placement <select aria-label="Club placement" className="ml-2 rounded-lg border border-slate-200 bg-white p-2" value={hybridClub} onChange={e => setHybridClub(e.target.value)}><option value={HYBRID_CLUBS.supabase}>Australia · synthetic Supabase</option><option value={HYBRID_CLUBS.icp}>USA · local ICP</option></select></label>}</div><p className="text-sm text-slate-500">{forcedBackend ? `Test backend is forced to ${forcedBackend}; changing data sources is disabled.` : mode === 'fixture' ? 'Fixture changes reset when this session closes.' : mode === 'supabase' ? 'Standalone synthetic Supabase provider only. No ICP actor connection is ever opened, and there is no production Supabase fallback.' : mode === 'hybrid' ? 'Placement selects synthetic Supabase or the local ICP canister. No fallback is used.' : 'Changes persist in the local canister. The member view uses a separate synthetic identity.'}</p>{mode === 'hybrid' && <PlacementAdminSettingsPanel controller={placementAdmin} />}</div></details>
      </div></main>
    </div><Toaster />
  </div>;
}
