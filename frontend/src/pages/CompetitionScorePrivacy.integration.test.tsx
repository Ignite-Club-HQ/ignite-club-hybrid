import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ hide: false, override: null as boolean | null, manager: false, home: 4, away: 2, writes: 0, icp: process.env.IGNITE_TEST_BACKEND_MODE === 'icp' }));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: () => {} }));
vi.mock('@/live/loadBackendRouting', () => ({ isFeatureRoutedToIcp: () => db.icp }));
vi.mock('@/live/targetRegistry', () => ({ getActiveIcpTarget: () => ({}) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'viewer' } }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/live/featureRouter', () => ({ withFeatureBackend: (_: string, p: any) => db.icp ? p.icp({ target: {}, identity: {} }) : p.supabase() }));
// Raw storage is never pre-masked: each transport read selects policy anew.
function scores() { return db.manager || !(db.override ?? db.hide) ? { home_score: db.home, away_score: db.away } : { home_score: null, away_score: null }; }
function match() { return { id: 'm', competition_id: 'c', home_team: 'Home', away_team: 'Away', home: { name: 'Home' }, away: { name: 'Away' }, status: 'completed', round_number: 1, revision: 0, ...scores() }; }
vi.mock('@/live/domains', () => ({ connectLiveCompetitionDomain: async () => ({ actor: {
 get_public_competition_page: async () => ({ __kind__: 'Ok', Ok: { competition: { name: 'Cup', points_win: 3, points_draw: 1, points_loss: 0 }, matches: [match()], hide_ladder: false, hidden_divisions: [] } }),
 list_matches: async () => ({ Ok: [match()] }),
 get_score_privacy: async () => [{ division: [], hide_scores: db.hide }, ...(db.override == null ? [] : [{ division: ['Junior'], hide_scores: db.override }])],
 set_score_privacy: async (_: string, division: string[], hide: boolean[]) => { db.writes++; if (division.length) db.override = hide[0] ?? null; else db.hide = hide[0]; return { Ok: null }; },
 set_match_result: async (_: string, h: bigint, a: bigint) => { db.home = Number(h); db.away = Number(a); return { Ok: null }; },
} }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
 rpc: async (_: string, p: any) => { db.home = p.p_home_score; db.away = p.p_away_score; return { error: null }; },
 from: (table: string) => {
 let update: any; let single = false; const q: any = {};
 for (const m of ['select', 'eq', 'order', 'in']) q[m] = () => q;
 q.update = (v: any) => { update = v; return q; };
 q.single = q.maybeSingle = () => { single = true; return q; };
 q.then = (resolve: any) => {
 if (update) { db.writes++; if (table === 'competitions') db.hide = update.hide_scores; else db.override = update.hide_scores; }
 const rows = table === 'competitions' ? [{ name: 'Cup', hide_scores: db.hide, points_win: 3, points_draw: 1, points_loss: 0 }] : table === 'competition_divisions' ? [{ name: 'Junior', hide_scores: db.override }] : table === 'competition_matches' ? [{ ...match(), competition_match_results: scores() }] : [];
 return Promise.resolve({ data: single ? rows[0] : rows, error: null }).then(resolve);
 }; return q;
 },
} }));
import { ScorePrivacyControls } from './CompetitionSettingsPage';
import { CompetitionFixturesPanel } from '@/components/CompetitionFixturesPanel';
function mount(settings = false) { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{settings && <ScorePrivacyControls competitionId='c' divisions={[{ id: 'd', name: 'Junior' }]} />}<CompetitionFixturesPanel competitionId='c' isAdmin={db.manager} divisions={[]} entries={[]} /></QueryClientProvider>); }
beforeEach(() => Object.assign(db, { hide: false, override: null, manager: false, home: 4, away: 2, writes: 0 }));
it.each([[true, null, true], [true, false, false], [false, true, true], [false, null, false]] as const)('selects member policy default %s override %s', async (hide, override, hidden) => {
 Object.assign(db, { hide, override }); mount();
 expect(await screen.findByText(hidden ? 'Scores hidden' : '4')).toBeInTheDocument();
 expect(screen.queryByRole('button', { name: /edit score/i })).not.toBeInTheDocument();
});
it('manager sees and enters raw scores despite hide', async () => {
 db.manager = true; db.hide = true; mount();
 fireEvent.click(await screen.findByRole('button', { name: /edit score/i }));
 const inputs = screen.getAllByRole('spinbutton');
 fireEvent.change(inputs[0], { target: { value: '7' } }); fireEvent.change(inputs[1], { target: { value: '3' } });
 fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
 await waitFor(() => expect(db.home).toBe(7)); expect(db.away).toBe(3);
});
it('settings persist competition hide and division show/hide/inherit and invalidate fixture reads', async () => {
 mount(true); await screen.findByText('4');
 fireEvent.click(screen.getByRole('switch', { name: 'Hide competition scores' })); await screen.findByText('Scores hidden');
 const select = screen.getByLabelText('Junior score privacy');
 fireEvent.change(select, { target: { value: 'show' } }); await screen.findByText('4');
 fireEvent.change(select, { target: { value: 'hide' } }); await screen.findByText('Scores hidden');
 fireEvent.change(select, { target: { value: 'inherit' } }); await waitFor(() => expect(db.override).toBeNull()); expect(db.writes).toBe(4);
});

import PublicCompetitionPage from './PublicCompetitionPage';
it('anonymous public page selects hidden policy from raw stored scores', async () => {
 db.hide = true;
 render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={['/c']}><Routes><Route path='/:id' element={<PublicCompetitionPage />} /></Routes></MemoryRouter></QueryClientProvider>);
 expect(await screen.findByText('Scores hidden')).toBeInTheDocument();
 expect(db.home).toBe(4);
});
