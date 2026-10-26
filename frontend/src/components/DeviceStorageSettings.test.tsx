// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeviceStorageSettings } from './DeviceStorageSettings';
const clear = vi.hoisted(() => vi.fn());
vi.mock('@/lib/clearDownloadedContent', () => ({ clearDownloadedContent: clear }));
afterEach(() => { cleanup(); clear.mockReset(); });
describe('download cleanup control', () => {
  it('runs one cleanup while pending and reports completion', async () => {
    let finish: (() => void) | undefined;
    clear.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    render(<DeviceStorageSettings />);
    const button = screen.getByRole('button', { name: 'Clear downloaded content' });
    fireEvent.click(button); fireEvent.click(button);
    expect(clear).toHaveBeenCalledTimes(1);
    finish?.();
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
    expect(screen.getByRole('status').textContent).toContain('cleared');
  });
  it('allows retry after unavailable device storage', async () => {
    clear.mockRejectedValueOnce(new Error('blocked')).mockResolvedValueOnce(undefined);
    render(<DeviceStorageSettings />);
    const button = screen.getByRole('button', { name: 'Clear downloaded content' });
    fireEvent.click(button);
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
    fireEvent.click(button);
    await waitFor(() => expect(clear).toHaveBeenCalledTimes(2));
  });
});