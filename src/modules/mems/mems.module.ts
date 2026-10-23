import { Module } from '@nestjs/common';
import { MemsApprovalsModule } from './approvals/approvals.module';
import { MemsAssignmentModule } from './assignment/assignment.module';
import { MemsAvailabilityModule } from './availability/availability.module';
import { MemsBorrowRequestsModule } from './borrow-requests/borrow-requests.module';
import { MemsHandoverModule } from './handover/handover.module';

/** Gốc module quản lý thiết bị Media; mỗi chức năng là một module con. */
@Module({
  imports: [
    MemsAvailabilityModule,
    MemsApprovalsModule,
    MemsBorrowRequestsModule,
    MemsAssignmentModule,
    MemsHandoverModule,
  ],
})
export class MemsModule {}
