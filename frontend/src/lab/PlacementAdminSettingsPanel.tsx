import { useState } from 'react';
import type { BackendPolicy, PlacementAdminController } from './placementAdminSettings';
import { detectDeviceCountry } from './deviceCountry';

const targetKey = (policy: BackendPolicy) => `${policy.backend}|${policy.targetAlias}|${policy.version}`;

function targetDescription(policy: BackendPolicy) {
  const kind = policy.targetKind ? ` · ${policy.targetKind}` : '';
  const region = policy.region ? ` · ${policy.region}` : '';
  return `${policy.targetAlias} · ${policy.version}${kind}${region}`;
}

export function PlacementAdminSettingsPanel({ controller }: { controller: PlacementAdminController }) {
  const [settings, setSettings] = useState(controller.settings());
  const [message, setMessage] = useState('');
  const [country, setCountry] = useState('AU');
  const [backend, setBackend] = useState<'icp' | 'supabase'>('supabase');
  const [assignmentTargetKey, setAssignmentTargetKey] = useState('');
  const [clubId, setClubId] = useState('hybrid-au');
  const [policyCountry, setPolicyCountry] = useState('AU');
  const [policyBackend, setPolicyBackend] = useState<'icp' | 'supabase'>('supabase');
  const [policyTargetKind, setPolicyTargetKind] = useState<BackendPolicy['targetKind']>('supabase-region');
  const [policyTargetAlias, setPolicyTargetAlias] = useState('supabase-au-primary');
  const [policyVersion, setPolicyVersion] = useState('v1');
  const [policyRegion, setPolicyRegion] = useState('ap-southeast-2');
  const deviceCountry = detectDeviceCountry();

  const selected = settings.countries.find(item => item.country === country);
  const selectedTargets = selected?.policies.filter(item => item.backend === backend && item.enabled) ?? [];
  const selectedTarget = selectedTargets.find(item => targetKey(item) === assignmentTargetKey) ?? selectedTargets[0];

  function assign() {
    try {
      if (!selectedTarget) throw new Error(`No approved ${backend} target for ${country}`);
      controller.assignClub({ clubId, country, backend, targetAlias: selectedTarget.targetAlias, version: selectedTarget.version });
      setSettings(controller.settings());
      setMessage(`${clubId} is assigned to ${country} · ${backend} · ${selectedTarget.targetAlias} ${selectedTarget.version}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Assignment rejected');
    }
  }

  function approveCountryTarget() {
    try {
      const normalizedCountry = policyCountry.trim().toUpperCase();
      const currentCountry = settings.countries.find(item => item.country === normalizedCountry);
      const target: BackendPolicy = {
        backend: policyBackend,
        enabled: true,
        targetAlias: policyTargetAlias.trim(),
        version: policyVersion.trim(),
        targetKind: policyTargetKind,
        region: policyRegion.trim() || undefined,
      };
      const policies = [
        ...(currentCountry?.policies.filter(item => targetKey(item) !== targetKey(target)) ?? []),
        target,
      ];
      controller.setCountryPolicy({
        country: normalizedCountry,
        allowedBackends: [...new Set(policies.filter(item => item.enabled).map(item => item.backend))],
        policies,
      });
      setSettings(controller.settings());
      setCountry(normalizedCountry);
      setBackend(policyBackend);
      setAssignmentTargetKey(targetKey(target));
      setMessage(`${normalizedCountry} approves ${policyBackend} · ${targetDescription(target)}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Country target rejected');
    }
  }

  function changePolicyBackend(next: 'icp' | 'supabase') {
    setPolicyBackend(next);
    setPolicyTargetKind(next === 'supabase' ? 'supabase-region' : 'icp-cloud-engine');
  }

  return <section aria-label="Placement settings" className="rounded-lg border p-5">
    <div className="flex items-center justify-between gap-4">
      <div><h2 className="text-xl font-semibold">Placement settings</h2><p className="text-sm text-muted-foreground">App-admin approved target registry · country policy always wins over club selection.</p>{deviceCountry && <p className="text-xs text-muted-foreground">Device locale suggests {deviceCountry}; this is advisory only.</p>}</div>
      <span className="text-xs text-muted-foreground">Approved aliases only</span>
    </div>
    <div className="mt-4 rounded-lg border border-dashed p-3">
      <h3 className="text-sm font-semibold">Country target policy</h3>
      <p className="text-xs text-muted-foreground">Approve target aliases only; do not enter Supabase URLs, anon keys, service keys, canister controller credentials, cycle wallets, root keys, or Cloud Engine secrets.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-6">
        <label className="text-sm">Policy country<input aria-label="Policy country" className="mt-1 w-full rounded border p-2" value={policyCountry} onChange={event => setPolicyCountry(event.target.value)} /></label>
        <label className="text-sm">Policy backend<select aria-label="Policy backend" className="mt-1 w-full rounded border p-2" value={policyBackend} onChange={event => changePolicyBackend(event.target.value as 'icp' | 'supabase')}><option value="supabase">Supabase</option><option value="icp">ICP</option></select></label>
        <label className="text-sm">Target type<select aria-label="Target type" className="mt-1 w-full rounded border p-2" value={policyTargetKind} onChange={event => setPolicyTargetKind(event.target.value as BackendPolicy['targetKind'])}>{policyBackend === 'supabase' ? <option value="supabase-region">Supabase database / region</option> : <><option value="icp-cloud-engine">ICP Cloud Engine</option><option value="icp-mainnet">ICP public mainnet</option></>}</select></label>
        <label className="text-sm">Target alias<input aria-label="Target alias" className="mt-1 w-full rounded border p-2" value={policyTargetAlias} onChange={event => setPolicyTargetAlias(event.target.value)} /></label>
        <label className="text-sm">Target version<input aria-label="Target version" className="mt-1 w-full rounded border p-2" value={policyVersion} onChange={event => setPolicyVersion(event.target.value)} /></label>
        <label className="text-sm">Region / engine<input aria-label="Region or engine" className="mt-1 w-full rounded border p-2" value={policyRegion} onChange={event => setPolicyRegion(event.target.value)} /></label>
      </div>
      <button className="mt-3 rounded border px-3 py-2 text-sm font-medium" type="button" onClick={approveCountryTarget}>Approve country target</button>
    </div>
    <div className="mt-4 grid gap-3 sm:grid-cols-5">
      <label className="text-sm">Club ID<input className="mt-1 w-full rounded border p-2" value={clubId} onChange={event => setClubId(event.target.value)} /></label>
      <label className="text-sm">Country<select className="mt-1 w-full rounded border p-2" value={country} onChange={event => setCountry(event.target.value)}>{settings.countries.map(item => <option key={item.country}>{item.country}</option>)}</select></label>
      <label className="text-sm">Backend<select className="mt-1 w-full rounded border p-2" value={backend} onChange={event => setBackend(event.target.value as 'icp' | 'supabase')}><option value="supabase">Supabase</option><option value="icp">ICP</option></select></label>
      <label className="text-sm">Approved target<select aria-label="Approved target" className="mt-1 w-full rounded border p-2" value={selectedTarget ? targetKey(selectedTarget) : ''} onChange={event => setAssignmentTargetKey(event.target.value)}>{selectedTargets.length ? selectedTargets.map(item => <option key={targetKey(item)} value={targetKey(item)}>{targetDescription(item)}</option>) : <option value="">No approved target</option>}</select></label>
      <button className="self-end rounded border px-3 py-2 text-sm font-medium" type="button" onClick={assign}>Assign approved target</button>
    </div>
    <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
      {settings.countries.map(policy => <div className="rounded border p-3" key={policy.country}><strong>{policy.country}</strong><p className="text-muted-foreground">Allowed: {policy.allowedBackends.join(', ') || 'none'}</p>{policy.policies.map(target => <p key={`${policy.country}-${targetKey(target)}`}>{target.backend}: {target.enabled ? targetDescription(target) : 'disabled'}</p>)}</div>)}
    </div>
    {message && <p className="mt-3 text-sm" role="status">{message}</p>}
  </section>;
}
