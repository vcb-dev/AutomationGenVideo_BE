import { Module } from '@nestjs/common';
import { ReturnService } from './returns.service';
import { MemsReturnsController } from './returns.controller';

@Module({
  controllers: [MemsReturnsController],
  providers: [ReturnService],
})
export class MemsReturnsModule {}
