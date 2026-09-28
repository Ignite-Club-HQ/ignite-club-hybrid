#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const configPath = process.argv.find(arg => arg.startsWith('--config='))?.slice(9) ?? path.join(root, '.local-icp', 'public.json');

function loadConfig() {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Missing ${configPath}; deploy the local ICP lab network first.`);
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (config.network !== 'local' || !/^[0-9a-f]{266}$/i.test(config.rootKey)) {
    throw new Error('Invalid local ICP configuration.');
  }
  if (config.internetIdentityCanisterId !== 'rdmx6-jaaaa-aaaaa-aaadq-cai') {
    throw new Error('Local Internet Identity backend canister ID is missing or invalid.');
  }
  const authorizeUrl = new URL(config.internetIdentityAuthorizeUrl);
  if (authorizeUrl.protocol !== 'http:' || authorizeUrl.hostname !== 'id.ai.localhost' || authorizeUrl.pathname !== '/authorize' || authorizeUrl.username || authorizeUrl.password) {
    throw new Error('Local Internet Identity authorize URL must be the loopback id.ai.localhost /authorize endpoint.');
  }
  return { ...config, authorizeUrl };
}

const config = loadConfig();
const response = await fetch(config.authorizeUrl, { cache: 'no-store', redirect: 'error' }).catch(error => {
  throw new Error(`Local Internet Identity authorize page is not reachable: ${error instanceof Error ? error.message : String(error)}`);
});
if (!response.ok) {
  throw new Error(`Local Internet Identity authorize page returned HTTP ${response.status}.`);
}
if (response.headers.get('x-ic-canister-id') !== 'uqzsh-gqaaa-aaaaq-qaada-cai') {
  throw new Error('Local Internet Identity authorize page did not come from the expected frontend canister.');
}

console.log(JSON.stringify({
  ok: true,
  authorizeUrl: config.authorizeUrl.toString(),
  backendCanisterId: config.internetIdentityCanisterId,
  frontendCanisterId: response.headers.get('x-ic-canister-id'),
}));
