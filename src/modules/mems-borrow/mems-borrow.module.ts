import { Module } from '@nestjs/common';
import { AssetBorrowHistoryService } from './asset-borrow-history.service';
import { BorrowHistoryLogService } from './borrow-history-log.service';
import { MemsBorrowController } from './mems-borrow.controller';
import { ReturnService } from './return.service';

@Module({
  controllers: [MemsBorrowController],
  providers: [AssetBorrowHistoryService, BorrowHistoryLogService, ReturnService],
})
export class MemsBorrowModule {}
