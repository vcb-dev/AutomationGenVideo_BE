import { Module } from '@nestjs/common'
import { LarkNotificationsModule } from '../lark-notifications/lark-notifications.module'
import { TaskAutoAssignModule } from '../task-auto-assign/task-auto-assign.module'
import { TaskAutoSettingsController } from './settings.controller'

@Module({
  imports: [TaskAutoAssignModule, LarkNotificationsModule],
  controllers: [TaskAutoSettingsController],
})
export class SettingsModule {}
