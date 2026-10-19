/** Pure deployment attestation rules. The transport must be authenticated
 * controller management calls under an exclusive deployment lock. */
function validate(binding, status) {
  if (Object.values(binding).some(v => typeof v !== 'string' || !v) || binding.keyName !== 'key_1' ||
      !status.moduleHash || !/^[a-f0-9]{64}$/.test(status.moduleHash) ||
      status.controllers.length !== 1 || status.controllers[0] !== binding.governor)
    throw new Error('Exclusive governor controller and installed original module required');
}
export async function attestDeployKey(binding, d) {
  const status = await d.status(); validate(binding, status);
  const original = await d.originalKey(); const expected = await d.configuredKey();
  if (!/^[a-f0-9]{192}$/.test(original) || original !== expected) throw new Error('Legacy photo key differs from configured key_1; upgrade blocked');
  const fresh = await d.status(); validate(binding, fresh);
  if (fresh.moduleHash !== status.moduleHash || await d.originalKey() !== original) throw new Error('Original module/key changed during attestation');
  const receipt = { ...binding, moduleHash: status.moduleHash, publicKeyHex: original };
  await d.save(receipt); return receipt;
}
export async function verifyDeployKey(binding, receipt, d) {
  if (Object.entries(binding).some(([k, v]) => receipt[k] !== v) || !/^[a-f0-9]{192}$/.test(receipt.publicKeyHex) || !/^[a-f0-9]{64}$/.test(receipt.moduleHash))
    throw new Error('Original deployment attestation required');
  validate(binding, await d.status());
  if (await d.originalKey() !== receipt.publicKeyHex || await d.configuredKey() !== receipt.publicKeyHex)
    throw new Error('Original photo key not preserved; deployment must remain locked');
}