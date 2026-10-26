import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ children: vi.fn(), names: vi.fn(), teams: vi.fn(), grants: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'parent-a' } }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/icpClubTeamLookup', () => ({ icpCtx: async () => ({ identity: { getPrincipal: () => ({ toText: () => 'parent-a' }) } }) }));
vi.mock('@/live/features/club', () => ({ listMyLiveOwnChildren: state.children, listLiveTeams: state.teams }));
vi.mock('@/live/features/membership', () => ({ getLiveMyRoleGrants: state.grants }));
vi.mock('@/live/features/vault', () => ({ resolveLivePiiTextBatch: state.names }));
import IcpChildrenPage from './IcpChildrenPage';
let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  state.children.mockResolvedValue([{ id: 'child-a', teams: [], parent: [{ toText: () => 'parent-a' }] }]);
  state.names.mockReturnValue(new Promise(() => {}));
});
afterEach(() => { cleanup(); client.clear(); });
const open = () => render(<QueryClientProvider client={client}><MemoryRouter><IcpChildrenPage /></MemoryRouter></QueryClientProvider>);
it('reveals authorized child controls without waiting for name decryption or global team discovery', async () => {
  open();
  expect(await screen.findByRole('button', { name: 'Remove child' })).toBeInTheDocument();
  expect(screen.getByLabelText('Retrieving child name')).toBeInTheDocument();
  expect(state.grants).not.toHaveBeenCalled();
  expect(state.teams).not.toHaveBeenCalled();
  expect(client.getQueryData(['icp-own-children', 'parent-a'])).toHaveLength(1);
  expect(client.getQueryData(['icp-own-children', 'parent-b'])).toBeUndefined();
});
it('failed child reads show retry rather than falsely reporting no children', async () => {
  state.children.mockRejectedValue(new Error('Denied'));
  open();
  expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  expect(screen.queryByText('No children added yet.')).not.toBeInTheDocument();
});