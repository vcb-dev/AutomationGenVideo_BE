import { Module } from '@nestjs/common';
import { TrackedChannelsService } from './tracked-channels.service';
import { TrackedChannelsController } from './tracked-channels.controller';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ChannelEnrichmentModule } from '../channel-enrichment/channel-enrichment.module';

@Module({
  imports: [ChannelEnrichmentModule],
  controllers: [TrackedChannelsController],
  providers: [TrackedChannelsService, PrismaService],
  exports: [TrackedChannelsService],
})
export class TrackedChannelsModule {}
