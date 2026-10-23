import { Module } from '@nestjs/common';
import { MemsAvailabilityModule } from '../availability/availability.module';
import { MemsLoanExtensionsController } from './loan-extensions.controller';
import { LoanExtensionsService } from './loan-extensions.service';

@Module({
  imports: [MemsAvailabilityModule],
  controllers: [MemsLoanExtensionsController],
  providers: [LoanExtensionsService],
})
export class MemsLoanExtensionsModule {}
