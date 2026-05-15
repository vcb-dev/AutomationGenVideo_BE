import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { LarkService } from '../src/modules/lark-sync/lark.service';

async function run() {
    console.log('Initializing app context to trigger Channel Sync on production DB...');
    const app = await NestFactory.createApplicationContext(AppModule);
    const service = app.get(LarkService);

    console.log('Calling syncChannelData()...');
    await service.syncChannelData();
    console.log('Sync completed successfully!');
    
    await app.close();
}

run().catch(err => {
    console.error('Error running manual sync:', err);
});
