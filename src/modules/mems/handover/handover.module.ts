import { Module } from '@nestjs/common';
import { MemsHandoverController } from './handover.controller';
import { HandoverService } from './handover.service';

@Module({
  controllers: [MemsHandoverController],
  providers: [HandoverService],
})
export class MemsHandoverModule {}
