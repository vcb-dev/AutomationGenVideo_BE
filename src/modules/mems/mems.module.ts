import { Module } from '@nestjs/common';
import { MemsAvailabilityModule } from './availability/availability.module';

/** Gốc module quản lý thiết bị Media; mỗi chức năng là một module con. */
@Module({
  imports: [MemsAvailabilityModule],
})
export class MemsModule {}
