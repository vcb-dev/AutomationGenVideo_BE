import { Module } from '@nestjs/common';
import { TrackedChannelsService } from './tracked-channels.service';
import { TrackedChannelsController } from './tracked-channels.controller';
import { PrismaService } from '../../common/prisma/prisma.service';

@Module({
  controllers: [TrackedChannelsController],
  providers: [TrackedChannelsService, PrismaService],
  exports: [TrackedChannelsService],
})
export class TrackedChannelsModule {}
