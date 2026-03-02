
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./src/app.module');
const { LarkService } = require('./src/modules/lark/lark.service');

async function bootstrap() {
    const app = await NestFactory.createApplicationContext(AppModule);
    const larkService = app.get(LarkService);

    console.log('Starting Sync...');
    try {
        await larkService.syncPermissionData();
        console.log('Permission sync done');
        await larkService.syncKPIData();
        console.log('KPI sync done');
        await larkService.syncHuykChannelData();
        console.log('Huyk Channel sync done');
    } catch (e) {
        console.error('Sync failed', e);
    } finally {
        await app.close();
    }
}

bootstrap();
