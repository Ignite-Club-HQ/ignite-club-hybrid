import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadOperatorIdentity } from './operatorTransport';

const dir = mkdtempSync(join(tmpdir(), 'operator-key-'));
const write = (name: string, pem: string) => { const p = join(dir, name); writeFileSync(p, pem); return p; };

describe('loadOperatorIdentity', () => {
  it('reads a PKCS#8 secp256k1 key as the same principal as its SEC1 form', () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
    const pkcs8 = loadOperatorIdentity(write('k1-pkcs8.pem', privateKey.export({ type: 'pkcs8', format: 'pem' }) as string));
    const sec1 = loadOperatorIdentity(write('k1-sec1.pem', privateKey.export({ type: 'sec1', format: 'pem' }) as string));
    expect(pkcs8.getPrincipal().toText()).toBe(sec1.getPrincipal().toText());
  });

  it('still reads PKCS#8 Ed25519 keys as Ed25519', () => {
    const { privateKey } = generateKeyPairSync('ed25519');
    const id = loadOperatorIdentity(write('ed.pem', privateKey.export({ type: 'pkcs8', format: 'pem' }) as string));
    expect(id.constructor.name).toBe('Ed25519KeyIdentity');
  });
});
