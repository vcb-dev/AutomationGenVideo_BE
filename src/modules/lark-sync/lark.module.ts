
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { LarkController } from './lark.controller';
import { LarkService } from './lark.service';
import { LarkNotifyService } from './lark-notify.service';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { CacheModule } from '../../common/cache/cache.module';

@Module({
    imports: [
        HttpModule,
        ConfigModule,
        PrismaModule,
        CacheModule,
    ],
    controllers: [LarkController],
    providers: [LarkService, LarkNotifyService],
    exports: [LarkService, LarkNotifyService],
})
export class LarkModule { }
