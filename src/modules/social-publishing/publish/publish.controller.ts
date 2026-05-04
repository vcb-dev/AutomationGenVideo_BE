import { Controller, Post, Body, UseGuards, Request } from '@nestjs/common';
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
  @ApiOperation({ summary: 'Đăng bài ngay lập tức lên MXH' })
  publish(@Body() dto: PublishDto, @Request() req) {
    return this.publishService.publishNow(req.user.id, dto);
  }
}
