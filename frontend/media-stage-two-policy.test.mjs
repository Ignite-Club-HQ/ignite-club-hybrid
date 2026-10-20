test('only a created store stopped inside install may resume', async () => {
  const { isResumableInstall } = await import('./media-stage-two-policy.mjs');
  const s = { binding, phase: 'install', pending: { kind: 'install' }, canisterId: 'abc-cai', objects: {}, receipts: [{ phase: 'create', result: { canisterId: 'abc-cai' } }] };
  assert.equal(isResumableInstall(s, binding), true);
  assert.equal(isResumableInstall({ ...s, phase: 'smoke', pending: { kind: 'smoke' } }, binding), false);
  assert.equal(isResumableInstall({ ...s, receipts: [{ phase: 'create', result: { canisterId: 'other-cai' } }] }, binding), false);
  assert.equal(isResumableInstall({ ...s, binding: { ...binding, budgetCycles: '9' } }, binding), false);
  assert.equal(isResumableInstall({ ...s, pending: { kind: 'create' }, phase: 'create', receipts: [] }, binding), false);
});
