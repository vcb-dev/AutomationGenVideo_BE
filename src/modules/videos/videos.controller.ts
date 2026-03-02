import {
  Controller,
  Post,
  Get,
  Body,
  UseInterceptors,
  UploadedFile,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody, ApiBearerAuth } from '@nestjs/swagger';
import { VideosService } from './videos.service';
import { UploadVideoDto, MarkAsPublishedDto } from './dto/upload-video.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('videos')
@Controller('videos')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class VideosController {
  constructor(private readonly videosService: VideosService) { }

  @Post('upload')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Upload video and check for duplicates' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
        title: { type: 'string' },
        description: { type: 'string' },
        channelId: { type: 'string' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  async uploadVideo(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadVideoDto,
    @Request() req,
  ) {
    if (!file) {
      return {
        success: false,
        error: 'No file uploaded',
      };
    }

    const result = await this.videosService.uploadAndCheckDuplicate(file, req.user.id, dto);

    if (!result.success) {
      return {
        success: false,
        duplicate: result.duplicate,
        message: 'Video is duplicate of existing video',
      };
    }

    return {
      success: true,
      video: result.video,
      message: 'Video uploaded successfully',
    };
  }

  @Post('mark-published')
  @ApiOperation({ summary: 'Mark video as published on platforms' })
  async markAsPublished(@Body() dto: MarkAsPublishedDto) {
    const result = await this.videosService.markAsPublished(
      dto.videoId,
      dto.platforms,
      dto.publishedAt,
    );

    return {
      success: true,
      video: result.video,
      posts: result.posts,
      message: `Video marked as published on ${dto.platforms.join(', ')}`,
    };
  }

  @Get('my-videos')
  @ApiOperation({ summary: 'Get my uploaded videos' })
  async getMyVideos(@Request() req) {
    const videos = await this.videosService.getUserVideos(req.user.id);

    return {
      success: true,
      videos,
      count: videos.length,
    };
  }
}
