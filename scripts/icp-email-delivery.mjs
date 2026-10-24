// External Resend transport; all queue claims and receipts remain on ICP.
import { createRequire } from 'node:module';
import { createPrivateKey, privateDecrypt, constants, createDecipheriv, createHash } from 'node:crypto';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const { Actor, HttpAgent } = require('@icp-sdk/core/agent');
const { Ed25519KeyIdentity } = require('@icp-sdk/core/identity');
export function decryptPayload(value, pem) {
  const payload = JSON.parse(value);
  if (payload.v !== 1) throw new Error('Unsupported email envelope');
  const key = privateDecrypt({ key: createPrivateKey(pem), padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(payload.key, 'base64'));
  const bytes = Buffer.from(payload.ciphertext, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
  decipher.setAuthTag(bytes.subarray(-16));
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(0, -16)), decipher.final()]).toString());
}
export async function deliverClaim(actor, claim, send, authority = '') {
  const { job } = claim;
  let outcome = 'unknown', provider = '';
  try {
    let payload;
    if (job.ciphertext) {
      const decrypted = decryptPayload(job.ciphertext, process.env.ICP_EMAIL_PRIVATE_KEY);
      if (decrypted.resource !== job.resource || typeof decrypted.to !== 'string') throw new Error('Email binding mismatch');
      const recipient = decrypted.to.trim().toLowerCase();
      const hash = text => createHash('sha256').update(text).digest('hex');
      if (job.kind === 'official') {
        if (hash(`${job.resource}:${recipient}`) !== claim.to || typeof decrypted.code !== 'string' || hash(`${job.resource}:${decrypted.code}`) !== claim.body) throw new Error('Official invitation mismatch');
        payload = { to: recipient, subject: claim.subject, text: `Accept your invitation: ${process.env.ICP_EMAIL_APP_URL}/competitions/officials/join?email=1&token=${encodeURIComponent(job.resource)}\nVerification code: ${decrypted.code}` };
      } else {
        if (job.kind !== 'pending_invite' || recipient !== claim.to.trim().toLowerCase()) throw new Error('Invitation recipient mismatch');
        payload = { to: recipient, subject: claim.subject, text: `Accept your invitation: ${process.env.ICP_EMAIL_APP_URL}/join/p/${encodeURIComponent(job.resource)}` };
      }
    } else payload = {
      to: claim.to, subject: claim.subject,
      text: claim.body + (claim.token ? `\n${process.env.ICP_EMAIL_APP_URL}/eoi-complete/${encodeURIComponent(claim.token)}` : ''),
    };
    const reply = await send(payload, `ignite:${authority ? `${authority}:` : ''}${job.id}`);
    if (reply.ok && reply.id) { outcome = 'sent'; provider = reply.id; }
    else if (reply.definiteFailure) outcome = 'failed';
  } catch { /* Unknown provider outcomes stay locked; never auto-expire/replay. */ }
  const result = await actor.finish_email_job(job.id, job.attempt, outcome, provider);
  if ('Err' in result) throw new Error('Email receipt was not acknowledged');
  return outcome;
}
async function main() {
  for (const key of ['ICP_EMAIL_WORKER_SEED', 'ICP_EMAIL_PRIVATE_KEY', 'RESEND_API_KEY', 'ICP_EMAIL_FROM', 'ICP_EMAIL_APP_URL', 'ICP_EMAIL_TARGETS_JSON']) {
    if (!process.env[key]) throw new Error(`Missing ${key}`);
  }
  const targets = JSON.parse(process.env.ICP_EMAIL_TARGETS_JSON);
  if (!Array.isArray(targets) || !targets.length || targets.length > 100) throw new Error('Invalid email target inventory');
  const identity = Ed25519KeyIdentity.fromSecretKey(Uint8Array.from(Buffer.from(process.env.ICP_EMAIL_WORKER_SEED, 'hex')));
  const agent = await HttpAgent.create({ identity, host: process.env.ICP_HOST || 'https://icp-api.io' });
  for (const target of targets) {
    if (!['club_domain', 'competition_domain'].includes(target.domain)) throw new Error('Invalid email authority');
    const { idlFactory } = await import(`../frontend/src/lab/bindings/${target.domain}/declarations/${target.domain}.did.js`);
    const actor = Actor.createActor(idlFactory, { agent, canisterId: target.canisterId });
    for (let i = 0; i < 20; i++) {
      const result = await actor.claim_email_job();
      if ('Err' in result) throw new Error('Email authority refused worker');
      const claim = result.Ok[0]; if (!claim) break;
      await deliverClaim(actor, claim, async (payload, idempotencyKey) => {
        const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ from: process.env.ICP_EMAIL_FROM, to: [payload.to], subject: payload.subject, text: payload.text }) });
        const body = await response.json().catch(() => ({}));
        return { ok: response.ok, id: body.id, definiteFailure: response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status) };
      }, target.canisterId);
    }
  }
}
if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) main().catch(() => { console.error('Email worker stopped; check configuration and retained receipts.'); process.exitCode = 1; });