/// <reference types="node" />
import * as fs from 'node:fs';
import * as path from 'node:path';

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { LarkService } from '../src/modules/lark-sync/lark.service';

function loadDotEnvIntoProcess(dotEnvPath: string) {
  if (!fs.existsSync(dotEnvPath)) return;
  const raw = fs.readFileSync(dotEnvPath, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1);
    // keep anything after '=' intact (URLs may contain '=' or '&')
    val = val.replace(/^\s+/, '').replace(/\s+$/, '');
    // strip optional surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

async function main() {
  // Load local .env without "source" (URLs contain '&' which breaks shell parsing).
  loadDotEnvIntoProcess(path.resolve(__dirname, '../.env'));

  // Force: sync directly from Lark -> SERVER_DATABASE_URL (no local -> server mirror step).
  process.env.LARK_SYNC_DIRECT_TO_SERVER = 'true';
  process.env.LARK_KPI_MIN_DATE = '2026-03-01';

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['log', 'warn', 'error'] });
  try {
    const lark = app.get(LarkService);
    const result = await lark.syncKPIData({ skipRemoteMirror: true });
    // eslint-disable-next-line no-console
    console.log('[sync-larkkpi-from-lark-to-server-direct] done:', result);
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[sync-larkkpi-from-lark-to-server-direct] failed:', e?.message || e);
  process.exit(1);
});

