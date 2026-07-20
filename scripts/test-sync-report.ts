import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { LarkService } from '../src/modules/lark-sync/lark.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const larkService = app.get(LarkService);
  
  console.log('Starting syncReportData()...');
  const result = await larkService.syncReportData();
  console.log('Result:', result);
  
  await app.close();
}

main().catch(err => {
  console.error('Error running test sync:', err);
  process.exit(1);
});
