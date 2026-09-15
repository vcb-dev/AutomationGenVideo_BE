import { Module } from '@nestjs/common'
import { TaskAutoAssignModule } from '../task-auto-assign/task-auto-assign.module'
import { TasksModule } from '../tasks/tasks.module'
import { TaskAutoSettingsController } from './settings.controller'

@Module({
  imports: [TaskAutoAssignModule, TasksModule],
  controllers: [TaskAutoSettingsController],
})
export class SettingsModule {}
