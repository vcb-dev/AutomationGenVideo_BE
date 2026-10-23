import { Module } from '@nestjs/common';
import { MemsApprovalsModule } from '../approvals/approvals.module';
import { MemsAvailabilityModule } from '../availability/availability.module';
import { BorrowRequestService } from './borrow-request.service';
import { MemsBorrowRequestsController } from './borrow-requests.controller';

@Module({
  imports: [MemsAvailabilityModule, MemsApprovalsModule],
  controllers: [MemsBorrowRequestsController],
  providers: [BorrowRequestService],
})
export class MemsBorrowRequestsModule {}
