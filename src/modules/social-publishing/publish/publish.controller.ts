import { Controller, Post, Get, Body, Param, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsString, IsArray, IsOptional } from 'class-validator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PublishService } from './publish.service';

class PublishDto {
  @IsString() accountId: string;
  @IsString() message: string;
  @IsOptional() @IsArray() mediaUrls?: string[];
  @IsOptional() @IsString() pageId?: string;
  @IsOptional() @IsString() privacy?: string;
}

@ApiTags('Social Publish')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('social/publish')
export class PublishController {
  constructor(private readonly publishService: PublishService) {}

  @Post()
  @ApiOperation({ summary: 'Đăng bài ngay lập tức lên MXH (sync — chờ đến khi xong)' })
  publish(@Body() dto: PublishDto, @Request() req) {
    return this.publishService.publishNow(req.user.id, dto);
  }

  @Post('async')
  @ApiOperation({ summary: 'Đăng bài bất đồng bộ — trả về postId ngay, worker xử lý trong ≤10 giây' })
  publishAsync(@Body() dto: PublishDto, @Request() req) {
    return this.publishService.publishAsync(req.user.id, dto);
  }

  @Get(':postId')
  @ApiOperation({ summary: 'Lấy trạng thái bài đăng (dùng sau publishAsync để poll kết quả)' })
  getStatus(@Param('postId') postId: string, @Request() req) {
    return this.publishService.getPostStatus(postId, req.user.id);
  }
}
