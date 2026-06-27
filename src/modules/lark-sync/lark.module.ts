
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { LarkController } from './lark.controller';
import { LarkService } from './lark.service';
import { LarkSyncService } from './lark-sync.service';
import { LarkGlobalIndoCronService } from './lark-global-indo-cron.service';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { ChannelEnrichmentModule } from '../channel-enrichment/channel-enrichment.module';
import { CacheModule } from '../../common/cache/cache.module';

@Module({
    imports: [
        HttpModule,
        ConfigModule,
        ScheduleModule,
        PrismaModule,
        ChannelEnrichmentModule,
        CacheModule,
    ],
    controllers: [LarkController],
    providers: [LarkService, LarkSyncService, LarkGlobalIndoCronService],
    exports: [LarkService, LarkSyncService, LarkGlobalIndoCronService],
})
export class LarkModule { }
