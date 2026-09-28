import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LabApp from '../src/lab/LabApp';
import { getForcedBackend } from '../src/lab/forcedBackend';

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  window.history.pushState({}, '', '/');
});

describe('lab app environment behavior', () => {
  it.skipIf(getForcedBackend() === 'icp')('runs the fixture or forced-Supabase editor flow without network access', async () => {
    globalThis.fetch = async () => {
      throw new Error('No network permitted in fixture editor test');
    };

    render(<LabApp />);

    const dataSource = screen.getByLabelText('Data source') as HTMLSelectElement;
    expect(dataSource.value).toBe(getForcedBackend() ?? 'fixture');
    expect(dataSource.disabled).toBe(getForcedBackend() !== null);

    await waitFor(() => expect(screen.getByRole('button', { name: /^Add$/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /^Add$/ }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Synthetic registration' } });
    fireEvent.change(screen.getByLabelText('Web address'), { target: { value: 'https://example.invalid/register' } });
    fireEvent.click(screen.getByRole('button', { name: /add link/i }));

    await waitFor(() => expect(screen.getAllByText('Synthetic registration').length).toBe(2));

    fireEvent.click(screen.getByRole('button', { name: 'Edit link' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Updated synthetic link' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.getAllByText('Updated synthetic link').length).toBe(2));

    fireEvent.click(screen.getByRole('switch', { name: 'Visible to members' }));
    await waitFor(() => expect(screen.getAllByText('Updated synthetic link').length).toBe(1));

    fireEvent.click(screen.getByRole('button', { name: 'Remove link' }));
    await waitFor(() => expect(screen.queryByText('Updated synthetic link')).toBeNull());
  });

  it('keeps ICP mode fail-closed in the lab environment with no fallback', async () => {
    const fetchStub = vi.fn().mockRejectedValue(new Error('Local ICP is not configured. Start and deploy the local canisters.'));
    globalThis.fetch = fetchStub as typeof fetch;

    render(<LabApp />);

    fireEvent.change(screen.getByLabelText('Data source'), { target: { value: 'icp' } });
    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert.textContent).toMatch(/Local ICP is not configured.*No fallback was used/i);
    });
  });

  it.skipIf(getForcedBackend() !== null)('supports hybrid mode selection without silently switching backends', async () => {
    const fetchStub = vi.fn().mockRejectedValue(new Error('Local ICP is not configured. Start and deploy the local canisters.'));
    globalThis.fetch = fetchStub as typeof fetch;

    render(<LabApp />);

    fireEvent.change(screen.getByLabelText('Data source'), { target: { value: 'hybrid' } });
    const placement = screen.getByLabelText('Club placement') as HTMLSelectElement;
    expect(placement.value).toBe('hybrid-au');

    fireEvent.change(placement, { target: { value: 'hybrid-au' } });
    await waitFor(() => expect(screen.getByText(/Placement selects synthetic Supabase or the local ICP canister\. No fallback is used\./i)).toBeTruthy());
    expect(screen.getByText(/App-admin control plane/i)).toBeTruthy();
  });
});
