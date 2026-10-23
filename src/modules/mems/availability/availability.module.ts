import { Module } from '@nestjs/common';
import { MemsAvailabilityController } from './availability.controller';
import { AvailabilityService } from './availability.service';

@Module({
  controllers: [MemsAvailabilityController],
  providers: [AvailabilityService],
  exports: [AvailabilityService],
})
export class MemsAvailabilityModule {}
