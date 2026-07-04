import { Module } from '@nestjs/common'
import { PrismaModule } from '../../../common/prisma/prisma.module'
import { TaskAutoWarehouseService } from './warehouse.service'
import { TaskAutoWarehouseController } from './warehouse.controller'
import { ScaleDataSourceGuard } from '../../../common/guards/scale-data-source.guard'

@Module({
  imports: [PrismaModule],
  controllers: [TaskAutoWarehouseController],
  providers: [TaskAutoWarehouseService, ScaleDataSourceGuard],
})
export class WarehouseModule {}
