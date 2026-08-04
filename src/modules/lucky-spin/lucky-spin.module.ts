import { Module } from '@nestjs/common';
import { LuckySpinController } from './lucky-spin.controller';
import { LuckySpinService } from './lucky-spin.service';

@Module({
  controllers: [LuckySpinController],
  providers: [LuckySpinService],
  exports: [LuckySpinService],
})
export class LuckySpinModule {}
