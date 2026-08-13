import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsString, IsArray, IsOptional } from 'class-validator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ScheduleService } from './schedule.service';

class CreateScheduledPostDto {
  @IsString() accountId: string;
  @IsString() message: string;
  @IsOptional() @IsArray() mediaUrls?: string[];
  @IsOptional() @IsString() pageId?: string;
  @IsOptional() @IsString() privacy?: string;
  @IsString() scheduledAt: string;
  @IsOptional() @IsString() thumbUrl?: string;
  @IsOptional() @IsString() taskId?: string;
}

class UpdateScheduledPostDto {
  @IsOptional() @IsString() message?: string;
  @IsOptional() @IsString() scheduledAt?: string;
  @IsOptional() @IsArray() mediaUrls?: string[];
}

@ApiTags('Social Schedule')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('social/schedule')
export class ScheduleController {
  constructor(private readonly scheduleService: ScheduleService) {}

  @Post()
  @ApiOperation({ summary: 'Lên lịch đăng bài' })
  create(@Body() dto: CreateScheduledPostDto, @Request() req) {
    return this.scheduleService.create(req.user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Lấy danh sách bài đã lên lịch' })
  findAll(@Request() req) {
    return this.scheduleService.findAll(req.user.id);
  }

  @Get('by-task/:taskId')
  @ApiOperation({ summary: 'Danh sách bài đã lên lịch gắn với 1 task' })
  findByTask(@Param('taskId') taskId: string) {
    return this.scheduleService.findByTask(taskId);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Cập nhật bài lên lịch (chỉ khi PENDING)' })
  update(@Param('id') id: string, @Body() dto: UpdateScheduledPostDto, @Request() req) {
    return this.scheduleService.update(id, req.user.id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Huỷ bài lên lịch' })
  cancel(@Param('id') id: string, @Request() req) {
    return this.scheduleService.cancel(id, req.user.id);
  }

  @Post(':id/retry')
  @ApiOperation({ summary: 'Thử lại bài bị lỗi' })
  retry(@Param('id') id: string, @Request() req) {
    return this.scheduleService.retry(id, req.user.id);
  }
}
