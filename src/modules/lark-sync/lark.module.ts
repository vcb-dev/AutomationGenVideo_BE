
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { LarkController } from './lark.controller';
import { LarkService } from './lark.service';
import { LarkSyncService } from './lark-sync.service';
import { PrismaModule } from '../../common/prisma/prisma.module';

@Module({
    imports: [
        HttpModule,
        ConfigModule,
        ScheduleModule,
        PrismaModule
    ],
    controllers: [LarkController],
    providers: [LarkService, LarkSyncService],
    exports: [LarkService, LarkSyncService],
})
export class LarkModule { }
