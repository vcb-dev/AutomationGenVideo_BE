import { Controller, Get, Query, Request, Res, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Response } from 'express'
import { JwtOrApiKeyGuard } from '../../api-keys/guards/jwt-or-api-key.guard'
import { QueryTaskDto } from '../tasks/dto/task.dto'
import { TaskExportService } from './task-export.service'

@ApiTags('task-auto')
@ApiBearerAuth()
@UseGuards(JwtOrApiKeyGuard)
@Controller('task-auto')
export class TaskExportController {
  constructor(private readonly taskExport: TaskExportService) {}

  @Get('tasks/export')
  @ApiOperation({
    summary:
      'Xuất Excel danh sách task ĐÃ HOÀN THÀNH (APPROVED) theo đúng bộ lọc đang chọn trên trang ' +
      "Nhiệm vụ — mỗi người thực hiện 1 sheet, kèm bảng KPI tháng (đạt / mục tiêu) và danh sách " +
      "video Facebook đã đăng trên page người đó cầm trong cùng khoảng ngày. Ô 'Trạng thái' " +
      'bị bỏ qua (luôn xuất task đã duyệt); tối đa 10.000 dòng/lần.',
  })
  async exportTasks(
    @Query() query: QueryTaskDto,
    @Res() response: Response,
    @Request() request: any,
  ) {
    const { buffer, filename } = await this.taskExport.exportApprovedTasks(
      query,
      request.user,
    )
    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    )
    response.setHeader('Content-Length', String(buffer.length))
    response.end(buffer)
  }
}
