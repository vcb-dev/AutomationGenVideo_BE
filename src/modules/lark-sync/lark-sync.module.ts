import { Module } from '@nestjs/common';
import { LarkService } from './lark.service';
import { LarkSyncService } from './lark-sync.service';
import { LarkSyncController } from './lark-sync.controller';
import { PrismaService } from '../../common/prisma/prisma.service';

@Module({
    controllers: [LarkSyncController],
    providers: [LarkService, LarkSyncService, PrismaService],
    exports: [LarkService, LarkSyncService],
})
export class LarkSyncModule { }
