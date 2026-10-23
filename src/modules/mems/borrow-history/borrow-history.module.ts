import { Module } from '@nestjs/common';
import { AssetBorrowHistoryService } from './asset-borrow-history.service';
import { MemsBorrowHistoryController } from './borrow-history.controller';
import { BorrowHistoryLogService } from './borrow-history-log.service';

@Module({
  controllers: [MemsBorrowHistoryController],
  providers: [AssetBorrowHistoryService, BorrowHistoryLogService],
})
export class MemsBorrowHistoryModule {}
