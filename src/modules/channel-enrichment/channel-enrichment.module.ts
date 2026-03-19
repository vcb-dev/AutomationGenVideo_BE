import { Module } from '@nestjs/common';
import { ChannelStatsEnrichmentService } from './channel-stats-enrichment.service';
import { PrismaModule } from '../../common/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [ChannelStatsEnrichmentService],
  exports: [ChannelStatsEnrichmentService],
})
export class ChannelEnrichmentModule {}
