import { Module } from "@nestjs/common";
import { PrismaModule } from "../../../common/prisma/prisma.module";
import { PerformanceGoalsController } from "./performance-goals.controller";
import { PerformanceGoalsService } from "./performance-goals.service";

@Module({
  imports: [PrismaModule],
  controllers: [PerformanceGoalsController],
  providers: [PerformanceGoalsService],
  exports: [PerformanceGoalsService],
})
export class PerformanceGoalsModule {}
