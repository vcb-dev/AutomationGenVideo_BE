import { Module } from '@nestjs/common'
import { TasksModule } from './tasks/tasks.module'
import { TeamsModule } from './teams/teams.module'
import { CatalogModule } from './catalog/catalog.module'
import { KpiModule } from './kpi/kpi.module'
import { UploadModule } from './upload/upload.module'
import { SettingsModule } from './settings/settings.module'
import { TaskAutoAssignModule } from './task-auto-assign/task-auto-assign.module'
import { NotificationsModule } from './notifications/notifications.module'
import { PerformanceGoalsModule } from './performance-goals/performance-goals.module'
import { ContentApprovalModule } from './content-approval/content-approval.module'
import { TaskExportModule } from './task-export/task-export.module'
import { VideoMatchingModule } from './video-matching/video-matching.module'
import { VideoScriptModule } from './video-script/video-script.module'
import { DailyPlansModule } from './daily-plans/daily-plans.module'
import { TaskComplianceModule } from './task-compliance/task-compliance.module'

@Module({
  imports: [
    // Đăng ký route tĩnh /tasks/export trước route động /tasks/:id.
    TaskExportModule,
    TasksModule,
    ContentApprovalModule,
    VideoMatchingModule,
    VideoScriptModule,
    TeamsModule,
    CatalogModule,
    KpiModule,
    UploadModule,
    SettingsModule,
    TaskAutoAssignModule,
    DailyPlansModule,
    TaskComplianceModule,
    NotificationsModule,
    PerformanceGoalsModule,
  ],
  exports: [TaskAutoAssignModule],
})
export class TaskAutoModule {}
