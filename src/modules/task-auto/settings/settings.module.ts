import { Module } from '@nestjs/common'
import { TaskAutoAssignModule } from '../task-auto-assign/task-auto-assign.module'
import { TaskAutoSettingsController } from './settings.controller'

@Module({
  imports: [TaskAutoAssignModule],
  controllers: [TaskAutoSettingsController],
})
export class SettingsModule {}
