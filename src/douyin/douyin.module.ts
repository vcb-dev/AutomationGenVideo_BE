import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { DouyinService } from './douyin.service';
import { DouyinController } from './douyin.controller';

@Module({
  imports: [HttpModule],
  providers: [DouyinService],
  controllers: [DouyinController],
  exports: [DouyinService],
})
export class DouyinModule {}
