import { Module } from '@nestjs/common';
import { MemsApprovalsModule } from './approvals/approvals.module';
import { MemsAssetPhotosModule } from './asset-photos/asset-photos.module';
import { MemsAssignmentModule } from './assignment/assignment.module';
import { MemsAvailabilityModule } from './availability/availability.module';
import { MemsBorrowHistoryModule } from './borrow-history/borrow-history.module';
import { MemsBorrowRequestsModule } from './borrow-requests/borrow-requests.module';
import { MemsHandoverModule } from './handover/handover.module';
import { MemsInspectionModule } from './inspection/inspection.module';
import { MemsReturnsModule } from './returns/returns.module';

/** Gốc module quản lý thiết bị Media; mỗi chức năng là một module con. */
@Module({
  imports: [
    MemsAvailabilityModule,
    MemsApprovalsModule,
    MemsBorrowRequestsModule,
    MemsAssignmentModule,
    MemsHandoverModule,
    MemsReturnsModule,
    MemsBorrowHistoryModule,
    MemsAssetPhotosModule,
    MemsInspectionModule,
  ],
})
export class MemsModule {}
