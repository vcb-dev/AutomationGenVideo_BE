import { Module } from '@nestjs/common';
import { MemsReturnAlertsController } from './return-alerts.controller';
import { ReturnAlertsService } from './return-alerts.service';

@Module({
  controllers: [MemsReturnAlertsController],
  providers: [ReturnAlertsService],
})
export class MemsReturnAlertsModule {}
