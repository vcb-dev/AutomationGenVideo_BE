
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { LarkService } from '../src/modules/lark-sync/lark.service';
import { PrismaClient } from '@prisma/client';

async function bootstrap() {
    console.log('🚀 Starting FORCE SYNC to Production Server...');
    console.log('📅 Date Filter: 2026-03-01 to Present');
    
    const app = await NestFactory.createApplicationContext(AppModule);
    const larkService = app.get(LarkService);

    try {
        console.log('🔄 Syncing KPI Data (Traffic/Global teams)...');
        // This will sync to local AND mirror to SERVER_DATABASE_URL because LARK_KPI_MIRROR_TO_SERVER=true
        const kpiResult = await larkService.syncKPIData({ forceLocalWrite: true });
        console.log('✅ KPI Sync Complete:', kpiResult);

        console.log('🔄 Syncing KPI DoDa Data (Leather team)...');
        const dodaResult = await larkService.syncKPIDoDaData({ forceLocalWrite: true });
        console.log('✅ DoDa KPI Sync Complete:', dodaResult);

        console.log('\n✨ ALL SYNC OPERATIONS COMPLETED SUCCESSFULLY!');
    } catch (error) {
        console.error('❌ Sync failed:', error);
    } finally {
        await app.close();
        process.exit(0);
    }
}

bootstrap();
