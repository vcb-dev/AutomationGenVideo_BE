import { Module } from '@nestjs/common';
import { AvailabilityService } from './availability.service';
import { BorrowRequestService } from './borrow-request.service';
import { MemsBorrowController } from './mems-borrow.controller';

@Module({
  controllers: [MemsBorrowController],
  providers: [AvailabilityService, BorrowRequestService],
  exports: [AvailabilityService],
})
export class MemsBorrowModule {}
