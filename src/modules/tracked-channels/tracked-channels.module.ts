import { Module } from '@nestjs/common';
import { TrackedChannelsService } from './tracked-channels.service';
import { TrackedChannelsController } from './tracked-channels.controller';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LarkModule } from '../lark-sync/lark.module';
import { ChannelEnrichmentModule } from '../channel-enrichment/channel-enrichment.module';

@Module({
  imports: [LarkModule, ChannelEnrichmentModule],
  controllers: [TrackedChannelsController],
  providers: [TrackedChannelsService, PrismaService],
  exports: [TrackedChannelsService],
})
export class TrackedChannelsModule {}
