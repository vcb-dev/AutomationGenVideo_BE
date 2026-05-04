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
    val = val.replace(/^\s+/, '').replace(/\s+$/, '');
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

async function main() {
  loadDotEnvIntoProcess(path.resolve(__dirname, '../.env'));
  process.env.LARK_SYNC_DIRECT_TO_SERVER = 'true';
  process.env.LARK_KPI_MIN_DATE = '2026-03-01';

  console.log('🚀 Starting ALL KPIs SYNC: Lark -> Server DB');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const lark = app.get(LarkService);
    
    console.log('📊 Syncing Main KPI...');
    const resultMain = await lark.syncKPIData({ skipRemoteMirror: true });
    console.log('✅ Main KPI Done:', resultMain?.synced ?? 0);

    console.log('🎨 Syncing KPI Do Da...');
    const resultDoDa = await lark.syncKPIDoDaData({ skipRemoteMirror: true });
    console.log('✅ KPI Do Da Done:', resultDoDa?.synced ?? 0);

    console.log('\n✨ ALL SYNC COMPLETED SUCCESSFULLY!');
  } catch (error) {
    console.error('❌ Sync failed:', error);
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error('💥 Fatal error:', e?.message || e);
  process.exit(1);
});
