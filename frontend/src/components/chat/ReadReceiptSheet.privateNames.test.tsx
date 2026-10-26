import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ profile: undefined as { display_name: string; avatar_url: null } | undefined, ids: [] as string[], kind: '', message: undefined as string | undefined }));
vi.mock('@/live/authBackendMode', () => ({ resolveAuthBackend: () => 'icp' }));
vi.mock('@/live/privateProfileSearchMode', () => ({ privateProfileSearchRehearsalEnabled: () => true }));
vi.mock('@/hooks/usePrivateChatProfiles', () => ({ usePrivateChatProfiles: (_chat: string, _viewer: string, ids: string[], _enabled: boolean, kind: string, message?: string) => { state.ids = ids; state.kind = kind; state.message = message; return () => state.profile; } }));
vi.mock('@/live/featureRouter', () => ({ withFeatureBackend: () => new Promise(() => {}) }));
vi.mock('@/components/ui/sheet', () => ({ Sheet: ({ children }: any) => <div>{children}</div>, SheetContent: ({ children }: any) => <div>{children}</div>, SheetHeader: ({ children }: any) => <div>{children}</div>, SheetTitle: ({ children }: any) => <h2>{children}</h2> }));
import { ReadReceiptSheet } from './ReadReceiptSheet';
beforeEach(() => { state.profile = undefined; state.ids = []; });
describe('private read receipt names', () => {
  it('binds broadcast reader disclosure to the exact displayed message', () => {
    render(<ReadReceiptSheet open={false} onOpenChange={vi.fn()} messageId="msg-broadcast-7" messageType="broadcast" contextId="broadcast" currentUserId="viewer" readers={[]} />);
    expect(state.message).toBe('msg-broadcast-7');
    expect(state.kind).toBe('group');
  });
  it('ignores stale prop names until the mounted exact-chat reader resolves', () => {
    const props = { open: false, onOpenChange: vi.fn(), messageId: 'message', messageType: 'dm' as const, contextId: 'chat', currentUserId: 'viewer', readers: [{ user_id: 'person', display_name: 'Stale cached name', avatar_url: null }] };
    const view = render(<ReadReceiptSheet {...props} />);
    expect(screen.queryByText('Stale cached name')).toBeNull();
    expect(state.ids).toContain('person');
    expect(state.kind).toBe('direct');
    state.profile = { display_name: 'Authorized name', avatar_url: null };
    view.rerender(<ReadReceiptSheet {...props} readers={[...props.readers]} />);
    expect(screen.getByText('Authorized name')).toBeTruthy();
    expect(screen.queryByText('Stale cached name')).toBeNull();
  });
});