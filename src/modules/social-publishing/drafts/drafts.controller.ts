import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsString, IsArray, IsOptional, IsEnum } from 'class-validator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { DraftsService } from './drafts.service';
import { SocialPlatform } from '@prisma/client';

class DraftDto {
  @IsOptional() @IsString() title?: string;
  @IsString() message: string;
  @IsOptional() @IsArray() mediaUrls?: string[];
  @IsOptional() @IsEnum(SocialPlatform) platform?: SocialPlatform;
  @IsOptional() @IsString() accountId?: string;
  @IsOptional() @IsString() pageId?: string;
  @IsOptional() @IsString() thumbUrl?: string;
}

class UpdateDraftDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() message?: string;
  @IsOptional() @IsArray() mediaUrls?: string[];
  @IsOptional() @IsEnum(SocialPlatform) platform?: SocialPlatform;
  @IsOptional() @IsString() accountId?: string;
  @IsOptional() @IsString() thumbUrl?: string;
}

@ApiTags('Social Drafts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('social/drafts')
export class DraftsController {
  constructor(private readonly draftsService: DraftsService) {}

  @Get()
  @ApiOperation({ summary: 'Lấy danh sách bài nháp' })
  findAll(@Request() req) {
    return this.draftsService.findAll(req.user.id);
  }

  @Post()
  @ApiOperation({ summary: 'Tạo bài nháp mới' })
  create(@Body() dto: DraftDto, @Request() req) {
    return this.draftsService.create(req.user.id, dto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Cập nhật bài nháp' })
  update(@Param('id') id: string, @Body() dto: UpdateDraftDto, @Request() req) {
    return this.draftsService.update(id, req.user.id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Xoá bài nháp' })
  remove(@Param('id') id: string, @Request() req) {
    return this.draftsService.remove(id, req.user.id);
  }
}
