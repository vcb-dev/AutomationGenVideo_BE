import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SapoRevenueService } from './sapo-revenue.service';
import { SapoRevenueController } from './sapo-revenue.controller';

@Module({
  imports: [ConfigModule],
  controllers: [SapoRevenueController],
  providers: [SapoRevenueService],
  exports: [SapoRevenueService],
})
export class SapoRevenueModule {}
