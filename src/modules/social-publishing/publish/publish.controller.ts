import { Controller, Post, Get, Body, Param, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsString, IsArray, IsOptional } from 'class-validator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PublishService } from './publish.service';
import { ScheduleService } from '../schedule/schedule.service';

class PublishDto {
  @IsString() accountId: string;
  @IsString() message: string;
  @IsOptional() @IsArray() mediaUrls?: string[];
  @IsOptional() @IsString() pageId?: string;
  @IsOptional() @IsString() privacy?: string;
  @IsOptional() @IsString() thumbUrl?: string;
}

@ApiTags('Social Publish')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('social/publish')
export class PublishController {
  constructor(
    private readonly publishService: PublishService,
    private readonly scheduleService: ScheduleService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Đăng bài ngay lập tức lên MXH (sync — chờ đến khi xong)' })
  publish(@Body() dto: PublishDto, @Request() req) {
    return this.publishService.publishNow(req.user.id, dto);
  }

  @Post('async')
  @ApiOperation({ summary: 'Đăng bài bất đồng bộ — trả về postId ngay, worker xử lý ngay lập tức' })
  async publishAsync(@Body() dto: PublishDto, @Request() req) {
    const result = await this.publishService.publishAsync(req.user.id, dto);
    // Kích hoạt worker ngay sau khi tạo job — không chờ cron 5s
    this.scheduleService.triggerNow();
    return result;
  }

  @Get(':postId')
  @ApiOperation({ summary: 'Lấy trạng thái bài đăng (dùng sau publishAsync để poll kết quả)' })
  getStatus(@Param('postId') postId: string, @Request() req) {
    return this.publishService.getPostStatus(postId, req.user.id);
  }
}
