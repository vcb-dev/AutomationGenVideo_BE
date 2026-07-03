import { Module } from '@nestjs/common'
import { TasksModule } from './tasks/tasks.module'
import { TeamsModule } from './teams/teams.module'
import { CatalogModule } from './catalog/catalog.module'
import { KpiModule } from './kpi/kpi.module'
import { WarehouseModule } from './warehouse/warehouse.module'
import { UploadModule } from './upload/upload.module'
import { SettingsModule } from './settings/settings.module'
import { TaskAutoAssignModule } from "./task-auto-assign/task-auto-assign.module";

@Module({
  imports: [
    TasksModule,
    TeamsModule,
    CatalogModule,
    KpiModule,
    WarehouseModule,
    UploadModule,
    SettingsModule,
    TaskAutoAssignModule,
  ],
  exports: [TaskAutoAssignModule],
})
export class TaskAutoModule {}
