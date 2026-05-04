import { Controller, Post, Get, Body, Query, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsString, IsArray, IsOptional, IsEnum, ValidateNested, ArrayMaxSize, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { QueueService } from './queue.service';
import { SocialPlatform } from '@prisma/client';

class EnqueueJobItemDto {
  @IsString()  accountId: string;

  @IsEnum(SocialPlatform)
  platform: SocialPlatform;

  @IsString()
  message: string;

  @IsOptional() @IsArray() @IsString({ each: true })
  mediaUrls?: string[];

  @IsOptional() @IsString()
  privacy?: string;

  @IsOptional() @IsString()
  pageId?: string;
}

class EnqueueBodyDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => EnqueueJobItemDto)
  jobs: EnqueueJobItemDto[];
}

@ApiTags('Social Queue')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('social/queue')
export class QueueController {
  constructor(private readonly queueService: QueueService) {}

  /**
   * Thêm nhiều jobs vào hàng chờ đăng bài.
   * Trả về mảng jobIds để frontend poll trạng thái.
   */
  @Post('enqueue')
  @ApiOperation({ summary: 'Thêm nhiều jobs vào hàng chờ — trả về jobIds để poll' })
  async enqueue(@Body() body: EnqueueBodyDto, @Request() req: any) {
    const jobIds = await this.queueService.enqueue(req.user.id, body.jobs);
    return { success: true, jobIds, total: jobIds.length };
  }

  /**
   * Poll trạng thái nhiều jobs cùng lúc.
   * Frontend gọi mỗi 3 giây để cập nhật UI.
   */
  @Get('status')
  @ApiOperation({ summary: 'Poll trạng thái jobs theo IDs (dùng ?ids=id1,id2,...)' })
  async getStatus(@Query('ids') ids: string, @Request() req: any) {
    const jobIds = ids ? ids.split(',').filter(Boolean).slice(0, 50) : [];
    if (jobIds.length === 0) return { jobs: [] };
    const jobs = await this.queueService.getJobsStatus(jobIds, req.user.id);
    return { jobs };
  }

  /**
   * Thống kê hàng chờ theo platform (waiting / processing / limit).
   */
  @Get('stats')
  @ApiOperation({ summary: 'Thống kê hàng chờ hiện tại theo platform' })
  getStats() {
    return this.queueService.getQueueStats();
  }
}
