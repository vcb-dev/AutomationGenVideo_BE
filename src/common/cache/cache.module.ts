import { Module } from '@nestjs/common';
import { CacheService } from './cache.service';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
    imports: [ScheduleModule],
    providers: [CacheService],
    exports: [CacheService],
})
export class CacheModule {}
