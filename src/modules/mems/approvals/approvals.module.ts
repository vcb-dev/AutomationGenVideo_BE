import { Module } from '@nestjs/common';
import { ApprovalService } from './approvals.service';
import { MemsApprovalsController } from './approvals.controller';

@Module({
  controllers: [MemsApprovalsController],
  providers: [ApprovalService],
  exports: [ApprovalService],
})
export class MemsApprovalsModule {}
