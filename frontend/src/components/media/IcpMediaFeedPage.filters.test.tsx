import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ club: 'winter-cats' as string | null, reads: vi.fn() }));
vi.mock('@/hooks/useClubTheme', () => ({ useClubTheme: () => ({ activeClubFilter: state.club }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'member' }, profile: null }) }));
vi.mock('react-router-dom', () => ({ useSearchParams: () => [new URLSearchParams(), vi.fn()] }));
vi.mock('@/live/mediaDecrypt', () => ({ storedIcpPrincipal: () => 'member' }));
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...await importOriginal<typeof import('@tanstack/react-query')>(),
  useQuery: (options: { queryKey: string[] }) => {
    state.reads(options.queryKey);
    if (['icp-gallery-card', 'icp-gallery-card-assets', 'icp-gallery-linked-post', 'icp-gallery-views'].includes(options.queryKey[0])) return { data: null };
    if (options.queryKey[0] === 'icp-gallery-moderation') return { data: [] };
    if (options.queryKey[0] === 'blocked-users') return { data: [] };
    return options.queryKey[0] === 'icp-principal' ? { data: 'member' } : {
      data: { posts: [], options: {
        clubs: [{ id: 'winter-cats', name: 'Winter Cats' }, { id: 'riverdogs', name: 'Riverdogs' }],
        teams: [{ id: 'peanut', name: 'Peanut', club_id: 'winter-cats' }, { id: 'hawks', name: 'Hawks', club_id: 'riverdogs' }],
        miniLeagues: [{ id: 'cats-league', name: 'Cats League', club_id: 'winter-cats' }, { id: 'dogs-league', name: 'Dogs League', club_id: 'riverdogs' }],
        competitions: [],
      } },
    };
  },
  useMutation: () => ({}), useQueryClient: () => ({}),
}));
vi.mock('@/components/ui/drawer', () => ({
  Drawer: ({ open, children }: any) => open ? <div>{children}</div> : null,
  DrawerContent: ({ children }: any) => <div>{children}</div>,
  DrawerHeader: ({ children }: any) => <div>{children}</div>,
  DrawerTitle: ({ children }: any) => <h2>{children}</h2>,
}));
vi.mock('@/components/media/IcpUploadPhotoSheet', () => ({ IcpUploadPhotoSheet: () => null }));
vi.mock('@/components/media/MediaHeaderSponsorStrip', () => ({ MediaHeaderSponsorStrip: () => null }));
vi.mock('@/components/MediaCommentSheet', () => ({ MediaCommentSheet: () => null }));
vi.mock('@/components/PhotoLightbox', () => ({ PhotoLightbox: () => null }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
import { IcpMediaFeedPage } from './IcpMediaFeedPage';
afterEach(() => { cleanup(); state.club = 'winter-cats'; state.reads.mockClear(); });
describe('gallery theme club scope', () => {
  it('offers only the theme club teams and leagues, including after clearing', () => {
    render(<IcpMediaFeedPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
    expect(screen.getByRole('button', { name: 'Peanut' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Cats League/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Riverdogs' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'All Clubs' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hawks' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Dogs League/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Peanut' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByRole('button', { name: 'Peanut' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Hawks' })).toBeNull();
  });
  it('keeps club selection available without a theme club and narrows teams locally', () => {
    state.club = null;
    render(<IcpMediaFeedPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
    fireEvent.click(screen.getByRole('button', { name: 'Riverdogs' }));
    expect(screen.getByRole('button', { name: 'Hawks' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Peanut' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByRole('button', { name: 'Peanut' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hawks' })).toBeTruthy();
  });
});