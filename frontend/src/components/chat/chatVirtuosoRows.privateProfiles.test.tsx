import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChatPrivateProfileRevision, ChatRowAdapter } from './chatVirtuosoRows';

describe('mounted labels behind row memoization', () => {
  it('reevaluates the same message on private-label acknowledgement and removal', () => {
    const message = { id: 'm1' };
    let allowed = false;
    const renderItem = vi.fn(() => <span>{allowed ? 'Authorized name' : 'Member'}</span>);
    const props = {
      message, signature: 'unchanged', renderItemRef: { current: renderItem },
      uniqueMessagesRef: { current: [message] }, indexByIdRef: { current: new Map([['m1', 0]]) },
      currentUserIdRef: { current: 'viewer' },
    };
    const ui = (revision: number) => <ChatPrivateProfileRevision.Provider value={revision}><ChatRowAdapter {...props} /></ChatPrivateProfileRevision.Provider>;
    const result = render(ui(0));
    expect(result.getByText('Member')).toBeTruthy();
    allowed = true; result.rerender(ui(1));
    expect(result.getByText('Authorized name')).toBeTruthy();
    allowed = false; result.rerender(ui(2));
    expect(result.queryByText('Authorized name')).toBeNull();
    expect(renderItem).toHaveBeenCalledTimes(3);
  });
});