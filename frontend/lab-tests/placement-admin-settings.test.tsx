import { fireEvent, render, screen } from '@testing-library/react';
import { Principal } from '@icp-sdk/core/principal';
import { describe, expect, it } from 'vitest';
import { PlacementAdminSettingsPanel } from '../src/lab/PlacementAdminSettingsPanel';
import { backendFromAssignment, createPlacementAdminController } from '../src/lab/placementAdminSettings';
import { PlacementAdminSettingsPage } from '../src/pages/PlacementAdminSettingsPage';

describe('placement admin settings', () => {
  it('rejects a club backend that its country does not allow', () => {
    const controller = createPlacementAdminController({
      countries: [{ country: 'AU', allowedBackends: ['supabase'], policies: [{ backend: 'supabase', enabled: true, targetAlias: 'supabase-au', version: 'v1' }, { backend: 'icp', enabled: true, targetAlias: 'icp-au', version: 'v1' }] }],
      clubs: [],
    });
    expect(() => controller.assignClub({ clubId: 'club-a', country: 'AU', backend: 'icp', targetAlias: 'icp-au', version: 'v1' })).toThrow('Backend is not allowed in AU');
  });

  it('requires an approved target version and preserves country assignment', () => {
    const controller = createPlacementAdminController({
      countries: [{ country: 'US', allowedBackends: ['icp', 'supabase'], policies: [{ backend: 'icp', enabled: true, targetAlias: 'icp-singapore', version: 'v2' }, { backend: 'supabase', enabled: true, targetAlias: 'supabase-us', version: 'v1' }] }],
      clubs: [],
    });
    expect(() => controller.assignClub({ clubId: 'club-us', country: 'US', backend: 'icp', targetAlias: 'icp-singapore', version: 'v1' })).toThrow('Target version is not approved');
    controller.assignClub({ clubId: 'club-us', country: 'US', backend: 'icp', targetAlias: 'icp-singapore', version: 'v2' });
    expect(controller.decision('club-us')).toEqual({ clubId: 'club-us', country: 'US', backend: 'icp', targetAlias: 'icp-singapore', version: 'v2' });
  });

  it('applies country-level policy changes before club-level backend assignment', () => {
    const controller = createPlacementAdminController({
      countries: [
        {
          country: 'AU',
          allowedBackends: ['supabase'],
          policies: [
            { backend: 'supabase', enabled: true, targetAlias: 'supabase-au-primary', version: 'v1' },
            { backend: 'icp', enabled: false, targetAlias: 'icp-au-disabled', version: 'v1' },
          ],
        },
      ],
      clubs: [],
    });

    expect(() =>
      controller.assignClub({ clubId: 'club-au', country: 'AU', backend: 'icp', targetAlias: 'icp-au-disabled', version: 'v1' }),
    ).toThrow('Backend is not allowed in AU');

    controller.setCountryPolicy({
      country: ' au ',
      allowedBackends: ['supabase', 'icp', 'icp'],
      policies: [
        { backend: 'supabase', enabled: true, targetAlias: 'supabase-au-primary', version: 'v1' },
        { backend: 'icp', enabled: true, targetAlias: 'icp-au-local', version: 'v2' },
      ],
    });

    controller.assignClub({ clubId: 'club-au', country: 'au', backend: 'icp', targetAlias: 'icp-au-local', version: 'v2' });

    expect(controller.settings().countries.find(policy => policy.country === 'AU')?.allowedBackends).toEqual(['supabase', 'icp']);
    expect(controller.decision('club-au')).toEqual({
      clubId: 'club-au',
      country: 'AU',
      backend: 'icp',
      targetAlias: 'icp-au-local',
      version: 'v2',
    });
  });

  it('lets one club move between approved Supabase and ICP targets without changing other clubs', () => {
    const controller = createPlacementAdminController({
      countries: [
        {
          country: 'US',
          allowedBackends: ['icp', 'supabase'],
          policies: [
            { backend: 'icp', enabled: true, targetAlias: 'icp-us-local', version: 'v1' },
            { backend: 'supabase', enabled: true, targetAlias: 'supabase-us-primary', version: 'v2' },
          ],
        },
      ],
      clubs: [
        { clubId: 'club-static', country: 'US', backend: 'supabase', targetAlias: 'supabase-us-primary', version: 'v2' },
      ],
    });

    controller.assignClub({ clubId: 'club-switching', country: 'US', backend: 'supabase', targetAlias: 'supabase-us-primary', version: 'v2' });
    controller.assignClub({ clubId: 'club-switching', country: 'US', backend: 'icp', targetAlias: 'icp-us-local', version: 'v1' });

    expect(controller.decision('club-switching')).toMatchObject({ backend: 'icp', targetAlias: 'icp-us-local' });
    expect(controller.decision('club-static')).toMatchObject({ backend: 'supabase', targetAlias: 'supabase-us-primary' });
  });

  it('converts club assignments to the exact backend routing payload', () => {
    const canister = Principal.fromText('aaaaa-aa');

    expect(backendFromAssignment({ clubId: 'club-au', country: 'AU', backend: 'supabase', targetAlias: 'supabase-au-primary', version: 'v1' })).toEqual({
      Supabase: { environment: 'supabase-au-primary' },
    });
    expect(backendFromAssignment({ clubId: 'club-us', country: 'US', backend: 'icp', targetAlias: 'icp-us-local', version: 'v1' }, canister)).toEqual({
      Icp: { canister },
    });
    expect(() => backendFromAssignment({ clubId: 'club-us', country: 'US', backend: 'icp', targetAlias: 'icp-us-local', version: 'v1' })).toThrow('ICP target requires a canister principal');
  });

  it('exposes approved club-level assignments in the settings panel and rejects disallowed country/backend pairs', () => {
    const controller = createPlacementAdminController({
      countries: [
        {
          country: 'AU',
          allowedBackends: ['supabase'],
          policies: [
            { backend: 'supabase', enabled: true, targetAlias: 'supabase-au-primary', version: 'v1' },
            { backend: 'icp', enabled: false, targetAlias: 'icp-au-disabled', version: 'v1' },
          ],
        },
        {
          country: 'US',
          allowedBackends: ['icp', 'supabase'],
          policies: [
            { backend: 'icp', enabled: true, targetAlias: 'icp-us-local', version: 'v1' },
            { backend: 'supabase', enabled: true, targetAlias: 'supabase-us-primary', version: 'v2' },
          ],
        },
      ],
      clubs: [],
    });

    render(<PlacementAdminSettingsPanel controller={controller} />);

    fireEvent.change(screen.getByLabelText('Club ID'), { target: { value: 'club-us' } });
    fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'US' } });
    fireEvent.change(screen.getByLabelText('Backend'), { target: { value: 'icp' } });
    fireEvent.click(screen.getByRole('button', { name: 'Assign approved target' }));

    expect(screen.getByRole('status').textContent).toContain('club-us is assigned to US · icp · icp-us-local v1');
    expect(controller.decision('club-us')).toEqual({
      clubId: 'club-us',
      country: 'US',
      backend: 'icp',
      targetAlias: 'icp-us-local',
      version: 'v1',
    });

    fireEvent.change(screen.getByLabelText('Club ID'), { target: { value: 'club-au' } });
    fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'AU' } });
    fireEvent.change(screen.getByLabelText('Backend'), { target: { value: 'icp' } });
    fireEvent.click(screen.getByRole('button', { name: 'Assign approved target' }));

    expect(screen.getByRole('status').textContent).toContain('No approved icp target for AU');
    expect(controller.decision('club-au')).toBeUndefined();
  });

  it('lets app admins approve country targets for Supabase regions, Cloud Engines, and ICP mainnet from the UI', () => {
    const controller = createPlacementAdminController({ countries: [], clubs: [] });

    render(<PlacementAdminSettingsPanel controller={controller} />);

    fireEvent.change(screen.getByLabelText('Policy country'), { target: { value: 'gb' } });
    fireEvent.change(screen.getByLabelText('Policy backend'), { target: { value: 'supabase' } });
    fireEvent.change(screen.getByLabelText('Target alias'), { target: { value: 'supabase-gb-london-primary' } });
    fireEvent.change(screen.getByLabelText('Target version'), { target: { value: 'db-v3' } });
    fireEvent.change(screen.getByLabelText('Region or engine'), { target: { value: 'eu-west-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve country target' }));

    expect(screen.getByRole('status').textContent).toContain('GB approves supabase · supabase-gb-london-primary · db-v3 · supabase-region · eu-west-2');

    fireEvent.change(screen.getByLabelText('Club ID'), { target: { value: 'club-gb' } });
    fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'GB' } });
    fireEvent.change(screen.getByLabelText('Backend'), { target: { value: 'supabase' } });
    fireEvent.change(screen.getByLabelText('Approved target'), { target: { value: 'supabase|supabase-gb-london-primary|db-v3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Assign approved target' }));

    expect(controller.decision('club-gb')).toEqual({
      clubId: 'club-gb',
      country: 'GB',
      backend: 'supabase',
      targetAlias: 'supabase-gb-london-primary',
      version: 'db-v3',
    });

    fireEvent.change(screen.getByLabelText('Policy country'), { target: { value: 'sg' } });
    fireEvent.change(screen.getByLabelText('Policy backend'), { target: { value: 'icp' } });
    fireEvent.change(screen.getByLabelText('Target type'), { target: { value: 'icp-cloud-engine' } });
    fireEvent.change(screen.getByLabelText('Target alias'), { target: { value: 'cloud-engine-sg-1' } });
    fireEvent.change(screen.getByLabelText('Target version'), { target: { value: 'engine-v1' } });
    fireEvent.change(screen.getByLabelText('Region or engine'), { target: { value: 'OpenCloud SG' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve country target' }));

    fireEvent.change(screen.getByLabelText('Club ID'), { target: { value: 'club-sg' } });
    fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'SG' } });
    fireEvent.change(screen.getByLabelText('Backend'), { target: { value: 'icp' } });
    fireEvent.change(screen.getByLabelText('Approved target'), { target: { value: 'icp|cloud-engine-sg-1|engine-v1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Assign approved target' }));

    expect(controller.decision('club-sg')).toMatchObject({
      country: 'SG',
      backend: 'icp',
      targetAlias: 'cloud-engine-sg-1',
      version: 'engine-v1',
    });

    fireEvent.change(screen.getByLabelText('Policy country'), { target: { value: 'ch' } });
    fireEvent.change(screen.getByLabelText('Policy backend'), { target: { value: 'icp' } });
    fireEvent.change(screen.getByLabelText('Target type'), { target: { value: 'icp-mainnet' } });
    fireEvent.change(screen.getByLabelText('Target alias'), { target: { value: 'icp-public-mainnet-eu' } });
    fireEvent.change(screen.getByLabelText('Target version'), { target: { value: 'mainnet-v1' } });
    fireEvent.change(screen.getByLabelText('Region or engine'), { target: { value: 'IC mainnet' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve country target' }));

    fireEvent.change(screen.getByLabelText('Club ID'), { target: { value: 'club-ch' } });
    fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'CH' } });
    fireEvent.change(screen.getByLabelText('Backend'), { target: { value: 'icp' } });
    fireEvent.change(screen.getByLabelText('Approved target'), { target: { value: 'icp|icp-public-mainnet-eu|mainnet-v1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Assign approved target' }));

    expect(controller.decision('club-ch')).toMatchObject({
      country: 'CH',
      backend: 'icp',
      targetAlias: 'icp-public-mainnet-eu',
      version: 'mainnet-v1',
    });
  });

  it('rejects mismatched backend target types before they can become country policy', () => {
    const controller = createPlacementAdminController({ countries: [], clubs: [] });

    expect(() => controller.setCountryPolicy({
      country: 'US',
      allowedBackends: ['supabase'],
      policies: [{ backend: 'supabase', enabled: true, targetAlias: 'bad-icp-shaped-supabase', version: 'v1', targetKind: 'icp-mainnet' }],
    })).toThrow('Supabase targets must use a Supabase region target type');

    expect(() => controller.setCountryPolicy({
      country: 'US',
      allowedBackends: ['icp'],
      policies: [{ backend: 'icp', enabled: true, targetAlias: 'bad-supabase-shaped-icp', version: 'v1', targetKind: 'supabase-region' }],
    })).toThrow('ICP targets must use an ICP target type');
  });

  it('rejects browser-entered target URLs and credential-shaped aliases', () => {
    const controller = createPlacementAdminController({ countries: [], clubs: [] });

    expect(() => controller.setCountryPolicy({
      country: 'AU',
      allowedBackends: ['supabase'],
      policies: [{ backend: 'supabase', enabled: true, targetAlias: 'https://db-host.example', version: 'v1', targetKind: 'supabase-region' }],
    })).toThrow('Backend target alias must be 2-63 URL-safe characters');

    expect(() => controller.setCountryPolicy({
      country: 'AU',
      allowedBackends: ['supabase'],
      policies: [{ backend: 'supabase', enabled: true, targetAlias: 'aaa.bbb.ccc', version: 'v1', targetKind: 'supabase-region' }],
    })).toThrow('Backend target alias must not contain URLs or credential-shaped values');
  });

  it('renders the ICP lab unavailable state by default and the app-admin surface when the app opts into supabase mode', () => {
    const controller = createPlacementAdminController({
      countries: [{ country: 'AU', allowedBackends: ['supabase'], policies: [{ backend: 'supabase', enabled: true, targetAlias: 'supabase-au-primary', version: 'v1' }] }],
      clubs: [],
    });

    const { unmount } = render(<PlacementAdminSettingsPage controller={controller} />);
    expect(screen.getByRole('heading', { name: /placement settings are unavailable in icp lab mode/i })).toBeTruthy();

    unmount();
    window.history.pushState({}, '', '/?backend=supabase');
    render(<PlacementAdminSettingsPage controller={controller} />);

    expect(screen.getByRole('heading', { name: /infrastructure \/ placement settings/i })).toBeTruthy();
    expect(screen.getAllByText(/country policy always wins over club selection/i).length).toBeGreaterThan(0);
    window.history.pushState({}, '', '/');
  });
});