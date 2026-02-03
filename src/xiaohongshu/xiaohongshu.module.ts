import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { XiaohongshuController } from './xiaohongshu.controller';
import { XiaohongshuService } from './xiaohongshu.service';

@Module({
  imports: [HttpModule],
  controllers: [XiaohongshuController],
  providers: [XiaohongshuService],
  exports: [XiaohongshuService],
})
export class XiaohongshuModule {}
