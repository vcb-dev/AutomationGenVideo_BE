import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { WorkReportController } from './work-report.controller';
import { WorkReportService } from './work-report.service';
import { LarkNotifyService } from './lark-notify.service';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { CacheModule } from '../../common/cache/cache.module';
import { SapoIntegrationModule } from '../sapo-integration/sapo-integration.module';

@Module({
    imports: [
        HttpModule,
        ConfigModule,
        PrismaModule,
        CacheModule,
        SapoIntegrationModule,
    ],
    controllers: [WorkReportController],
    providers: [WorkReportService, LarkNotifyService],
    exports: [WorkReportService, LarkNotifyService],
})
export class WorkReportModule { }

/** Alias tương thích ngược */
export { WorkReportModule as LarkModule };
