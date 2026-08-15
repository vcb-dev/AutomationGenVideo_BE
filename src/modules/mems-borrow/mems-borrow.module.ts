import { Module } from '@nestjs/common';
import { ApprovalService } from './approval.service';
import { AssetBorrowHistoryService } from './asset-borrow-history.service';
import { AssignmentService } from './assignment.service';
import { AvailabilityService } from './availability.service';
import { BorrowRequestService } from './borrow-request.service';
import { HandoverService } from './handover.service';
import { MemsBorrowController } from './mems-borrow.controller';
import { ReturnService } from './return.service';

@Module({
  controllers: [MemsBorrowController],
  providers: [
    AssetBorrowHistoryService,
    AvailabilityService,
    BorrowRequestService,
    ApprovalService,
    AssignmentService,
    HandoverService,
    ReturnService,
  ],
  exports: [AvailabilityService],
})
export class MemsBorrowModule {}
