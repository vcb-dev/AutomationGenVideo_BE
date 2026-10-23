import { Module } from '@nestjs/common';
import { MemsApprovalsModule } from './approvals/approvals.module';
import { MemsAvailabilityModule } from './availability/availability.module';
import { MemsBorrowRequestsModule } from './borrow-requests/borrow-requests.module';

/** Gốc module quản lý thiết bị Media; mỗi chức năng là một module con. */
@Module({
  imports: [MemsAvailabilityModule, MemsApprovalsModule, MemsBorrowRequestsModule],
})
export class MemsModule {}
