// Explicit preparation only. Authenticated authority/exclusion and authorized
// keys are supplied by the existing operator boundary; never inferred here.
import {preparePrivateNameArtifact, verifyPrivateNameArtifact} from './private-name-plan-artifact.mjs';
import {encryptName, encryptClubName} from './convert-private-names.mjs';
import {canonical} from './migrate-club-plan.mjs';

export async function prepareVerifiedPrivateNameArtifact(input, {accounts, resolveAuthority, assertEvidence, decryptCiphertext, readOriginal}) {
  if (!accounts || !Array.isArray(accounts.rows) || !accounts.request || accounts.rows.length > 4096 || typeof resolveAuthority !== 'function' || typeof assertEvidence !== 'function' || typeof decryptCiphertext !== 'function') throw Error('Complete authenticated preparation dependencies required');
  input = structuredClone(input); accounts = structuredClone(accounts);
  const guard = async () => { if (await assertEvidence({request:structuredClone(accounts.request), revision:accounts.revision, identityId:input.identityId, deploymentHash:input.deploymentHash, sinks:structuredClone(input.sinks)}) !== true) throw Error('Verified baseline, management exclusion and authority evidence required'); };
  await guard();
  const {DerivedPublicKey,IbeCiphertext} = await import(new URL('../frontend/node_modules/@icp-sdk/vetkeys/dist/lib/index.es.js', import.meta.url).href);
  try { for (const sink of input.sinks) DerivedPublicKey.deserialize(Uint8Array.from(sink.publicKey)); } catch { throw Error('Invalid original PII public key'); }
  const planned = new Map(input.rows.map(row => [row.accountId,row]));
  const existingOriginals = new Map();
  if (planned.size !== input.rows.length) throw Error('Duplicate prepared account');
  const aliases = new Set(), subjects = new Set();
  for (const row of input.rows) {
    if (subjects.has(row.subject)) throw Error('Duplicate prepared subject');
    subjects.add(row.subject);
  }
  // Validate the entire account population before resolving any authority.
  // An omitted nameless account still participates in alias ownership.
  for (const account of accounts.rows) {
    if (!Array.isArray(account.principals) || !account.principals.length || account.principals.length > 8) throw Error('Complete account aliases required');
    for (const alias of account.principals) {
      if (typeof alias !== 'string' || !alias || aliases.has(alias)) throw Error('Ambiguous account aliases');
      aliases.add(alias);
    }
    const kind = account.originalAuthority?.kind;
    const name = account.profile?.display_name;
    if (!['NoName','Unresolved','Existing'].includes(kind)) throw Error('Explicit original authority required');
    if (kind === 'NoName' && name) throw Error('Named account cannot disappear from conversion');
    if (kind === 'Existing' && (!account.principals.includes(account.originalAuthority.subject) || name !== `pii-display-name:v1:${account.originalAuthority.sink}:${account.originalAuthority.subject}`)) throw Error('Original reference authority changed');
    if (typeof name === 'string' && name.startsWith('pii-display-name:') && kind !== 'Existing') throw Error('Original reference authority unresolved');
  }
  const seen = new Set();
  for (const account of accounts.rows) {
    if (seen.has(account.accountId) || !Array.isArray(account.principals) || !account.principals.length || !Array.isArray(account.sourceDigest) || account.sourceDigest.length !== 32 || !['Active','Suspended'].includes(account.status) || !/^[0-9]+$/.test(account.version)) throw Error('Complete account metadata required');
    seen.add(account.accountId);
    const row=planned.get(account.accountId);
    const name=account.profile?.display_name;
    if (typeof name !== 'string' || !name.trim()) { if (row) throw Error('Nameless account cannot acquire a prepared name'); continue; }
    // Existing names also need exact replicas; never silently omit them.
    if (!row || !account.principals.includes(row.subject)) throw Error('Named account omitted or alias changed');
    await guard();
    const authority = await resolveAuthority(structuredClone(account), structuredClone(accounts.request));
    await guard();
    if (!authority || authority.sink !== row.sink || authority.subject !== row.subject || !input.sinks.some(s => s.id === authority.sink) || !account.principals.includes(authority.subject)) throw Error('Authenticated original name authority unresolved');
    if (account.originalAuthority?.kind === 'Existing' && (account.originalAuthority.sink !== authority.sink || account.originalAuthority.subject !== authority.subject)) throw Error('Original reference authority changed');
    if (account.originalAuthority?.kind === 'Existing') {
      if (typeof readOriginal !== 'function') throw Error('Authoritative original ciphertext reader required');
      const target={sink:row.sink,subject:row.subject};
      await guard();
      const original=structuredClone(await readOriginal({...target}));
      await guard();
      if (!original || original.subject!==row.subject || original.field!=='display_name' || original.master_key_id!=='vetkey-ibe-v1' || !Array.isArray(original.ciphertext) || !original.ciphertext.length || original.ciphertext.length>4096 || original.ciphertext.some(b=>!Number.isInteger(b)||b<0||b>255)) throw Error('Exact authoritative original ciphertext required');
      let originalName;
      try {
        IbeCiphertext.deserialize(Uint8Array.from(original.ciphertext));
        originalName=await decryptCiphertext({...target,club:null,identity:`${row.subject}\u001fdisplay_name`,ciphertext:Uint8Array.from(original.ciphertext)});
      } catch { throw Error('Authoritative original name decryption refused'); }
      await guard();
      if (originalName!==row.name) throw Error('Prepared name differs from authoritative original');
      existingOriginals.set(row.subject,{target,original});
    }
    if (!name.startsWith('pii-display-name:') && name !== row.name) throw Error('Prepared source name changed');
  }
  if ([...planned.keys()].some(id=>!seen.has(id))) throw Error('Foreign prepared account');
  // Existing randomized original bytes must survive replica preparation;
  // re-encrypting the same name would conflict with create-only conversion.
  const artifact = await preparePrivateNameArtifact(input,{encryptClubName,encryptName:async(key,subject,name)=>existingOriginals.get(subject)?.original.ciphertext??encryptName(key,subject,name)});
  // Every saved byte string must decrypt using its exact authorized domain.
  // No plaintext, derived-key material or guessable name hashes are retained.
  const source = new Map(input.rows.map(r=>[r.accountId,r.name]));
  for (const row of artifact.body.rows) {
    for (const club of [null,...row.clubs.map(c=>c.id)]) {
      await guard();
      const ciphertext=club===null?row.ciphertext:row.clubs.find(c=>c.id===club).ciphertext;
      try { IbeCiphertext.deserialize(Uint8Array.from(ciphertext)); } catch { throw Error('Invalid saved name ciphertext'); }
      const snapshot=canonical(artifact);
      let plaintext;
      try { plaintext = await decryptCiphertext({sink:row.sink,subject:row.subject,club,identity:`${club===null?row.subject:`clubnames:${club}`}\u001fdisplay_name`,ciphertext:Uint8Array.from(ciphertext)}); } catch { throw Error('Exact original/club cryptographic preflight refused'); }
      await guard();
      if (canonical(artifact)!==snapshot || plaintext !== source.get(row.accountId)) throw Error('Exact original/club cryptographic preflight mismatch');
    }
  }
  for (const {target,original} of existingOriginals.values()) {
    await guard();
    const current=await readOriginal({...target});
    await guard();
    if(canonical(current)!==canonical(original))throw Error('Authoritative original ciphertext changed during preparation');
  }
  await guard(); verifyPrivateNameArtifact(artifact,artifact.hash);
  return artifact;
}