/// <reference types="node" />
import axios from 'axios';
import { execSync } from 'node:child_process';
import * as process from 'node:process';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function run(label: string, command: string) {
  // eslint-disable-next-line no-console
  console.log(`[deploy-sync] ${label}`);
  execSync(command, { stdio: 'inherit' });
}

async function callSync(baseUrl: string, endpoint: string) {
  const url = `${baseUrl.replace(/\/$/, '')}${endpoint}`;
  // eslint-disable-next-line no-console
  console.log(`[deploy-sync] POST ${url}`);
  const res = await axios.post(url, undefined, { timeout: 10 * 60 * 1000 });
  // eslint-disable-next-line no-console
  console.log(`[deploy-sync] OK ${endpoint}:`, res?.data?.message || 'success');
}

async function main() {
  // Guard env to fail fast with clear message.
  requireEnv('DATABASE_URL');
  requireEnv('SERVER_DATABASE_URL');

  const localApiBase = process.env.LOCAL_API_BASE_URL || 'http://localhost:3000/api';

  // 1) Lark -> Local
  await callSync(localApiBase, '/lark/sync-hr');
  await callSync(localApiBase, '/lark/sync-kpi');
  await callSync(localApiBase, '/lark/sync-kpi-do-da');
  await callSync(localApiBase, '/lark/reset-channel');

  // 2) Local -> Server
  run('Sync users local -> server', 'npm run sync:users:to-server');
  run('Sync channels local -> server', 'npm run sync:channel:to-server');
  run('Sync kpi local -> server', 'npm run sync:larkkpi:to-server');
  run('Sync kpi_do_da local -> server', 'npm run sync:larkkpi-doda:to-server');

  // eslint-disable-next-line no-console
  console.log('[deploy-sync] Completed full flow: Lark -> Local -> Server');
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[deploy-sync] failed:', e?.response?.data || e?.message || e);
  process.exit(1);
});
