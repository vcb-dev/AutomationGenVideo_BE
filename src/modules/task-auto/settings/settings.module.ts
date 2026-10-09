import { Module } from '@nestjs/common'
import { NotificationsModule } from '../notifications/notifications.module'
import { TaskAutoAssignModule } from '../task-auto-assign/task-auto-assign.module'
import { TaskAutoSettingsController } from './settings.controller'

@Module({
  imports: [TaskAutoAssignModule, NotificationsModule],
  controllers: [TaskAutoSettingsController],
})
export class SettingsModule {}
