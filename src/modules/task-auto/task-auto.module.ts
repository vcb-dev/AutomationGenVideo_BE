import { Module } from '@nestjs/common'
import { TasksModule } from './tasks/tasks.module'
import { TeamsModule } from './teams/teams.module'
import { CatalogModule } from './catalog/catalog.module'
import { KpiModule } from './kpi/kpi.module'
import { WarehouseModule } from './warehouse/warehouse.module'
import { UploadModule } from './upload/upload.module'
import { SettingsModule } from './settings/settings.module'
import { TaskAutoAssignModule } from "./task-auto-assign/task-auto-assign.module";
import { NotificationsModule } from './notifications/notifications.module'
import { PerformanceGoalsModule } from './performance-goals/performance-goals.module'

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
    NotificationsModule,
    PerformanceGoalsModule,
  ],
  exports: [TaskAutoAssignModule],
})
export class TaskAutoModule {}
