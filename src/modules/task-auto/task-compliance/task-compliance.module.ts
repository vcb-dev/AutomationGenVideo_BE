import { Module } from "@nestjs/common";
import { PrismaModule } from "../../../common/prisma/prisma.module";
import {
  TaskComplianceController,
  TaskCompliancePayrollSyncController,
} from "./task-compliance.controller";
import { TaskComplianceService } from "./task-compliance.service";

@Module({
  imports: [PrismaModule],
  controllers: [TaskComplianceController, TaskCompliancePayrollSyncController],
  providers: [TaskComplianceService],
  exports: [TaskComplianceService],
})
export class TaskComplianceModule {}
