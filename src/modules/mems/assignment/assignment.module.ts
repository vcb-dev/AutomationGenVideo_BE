import { Module } from '@nestjs/common';
import { MemsAvailabilityModule } from '../availability/availability.module';
import { MemsAssignmentController } from './assignment.controller';
import { AssignmentService } from './assignment.service';

@Module({
  imports: [MemsAvailabilityModule],
  controllers: [MemsAssignmentController],
  providers: [AssignmentService],
})
export class MemsAssignmentModule {}
