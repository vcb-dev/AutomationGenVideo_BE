import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { HeygenVideoController } from './heygen-video.controller';
import { HeygenVideoService } from './heygen-video.service';

@Module({
  imports: [HttpModule],
  controllers: [HeygenVideoController],
  providers: [HeygenVideoService],
  exports: [HeygenVideoService],
})
export class HeygenVideoModule {}
