import { Controller, Post, Get, Put, Delete, Body, Param, Query, HttpCode, HttpStatus, HttpException, Res, UseInterceptors, UploadedFile, Req } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { AiIntegrationService } from './ai-integration.service';
import { SearchVideoDto, UserVideosDto } from './dto/search-video.dto';
import { MixVideoAutoDto } from './dto/mix-video.dto';

@ApiTags('AI Integration')
@Controller('ai')
export class AiIntegrationController {
  constructor(private readonly aiService: AiIntegrationService) { }

  @Post('search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Search for videos using AI service (v2)' })
  @ApiResponse({ status: 200, description: 'Return search results or task ID if async.' })
  @ApiResponse({ status: 202, description: 'Async search started, returns task_id.' })
  async search(@Body() searchDto: SearchVideoDto) {
    return this.aiService.searchVideos(
      searchDto.platform,
      searchDto.keyword,
      searchDto.min_likes || 0,
      searchDto.min_views || 0,
      searchDto.max_results || 30,
      searchDto.use_cache !== false,
      searchDto.async_mode || false,
      searchDto.search_type || 'posts',
      searchDto.page || 1,
      searchDto.min_comments || 0,
      searchDto.search_mode ?? 'hashtag',
      searchDto.session_id,
    );
  }

  @Post('user-videos')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get videos from a specific user/channel' })
  @ApiResponse({ status: 200, description: 'Return user videos.' })
  async getUserVideos(@Body() userVideosDto: UserVideosDto) {
    return this.aiService.getUserVideos(
      userVideosDto.platform,
      userVideosDto.username,
      userVideosDto.max_results,
      userVideosDto.until_date,
      userVideosDto.start_date,
      userVideosDto.end_date,
      userVideosDto.force_refresh || false,
      (userVideosDto as any).channel_url || undefined, // URL đầy đủ từ link_channel
    );
  }

  @Get('search/status/:taskId')
  @ApiOperation({ summary: 'Check async search task status' })
  @ApiResponse({ status: 200, description: 'Return task status and results if completed.' })
  async checkTaskStatus(@Param('taskId') taskId: string) {
    return this.aiService.checkTaskStatus(taskId);
  }

  @Get('videos/by-channel')
  @ApiOperation({ summary: 'Get videos by channel from database' })
  @ApiQuery({ name: 'platform', required: true })
  @ApiQuery({ name: 'username', required: true })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'sortBy', required: false, enum: ['views', 'likes', 'date'] })
  @ApiQuery({ name: 'order', required: false, enum: ['asc', 'desc'] })
  @ApiQuery({ name: 'period', required: false, enum: ['yesterday', 'week', 'month', 'all'] })
  @ApiResponse({ status: 200, description: 'Return channel videos.' })
  async getVideosByChannel(
    @Query('platform') platform: string,
    @Query('username') username: string,
    @Query('limit') limit?: number,
    @Query('sortBy') sortBy?: string,
    @Query('order') order?: string,
    @Query('period') period?: string,
  ) {
    return this.aiService.getVideosByChannel(
      platform,
      username,
      limit || 20,
      sortBy || 'views',
      order || 'desc',
      period
    );
  }

  @Post('facebook/insights')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Analyze Facebook competitor channel (Gemini insights)' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['url'],
      properties: {
        url: { type: 'string', example: 'https://www.facebook.com/yourpage' },
        max_posts: { type: 'number', default: 30 },
        force_method: { type: 'string', enum: ['auto', 'graph', 'apify'], default: 'apify' },
        language: { type: 'string', default: 'vi' },
      },
    },
  })
  async analyzeFacebookCompetitor(@Body() body: any) {
    const { url, max_posts, force_method, language, start_date, end_date, force_refresh } = body || {};
    if (!url) {
      throw new HttpException('url is required', HttpStatus.BAD_REQUEST);
    }
    return this.aiService.analyzeFacebookCompetitor(
      url,
      max_posts ?? 200,
      (force_method as any) || 'apify',
      language || 'vi',
      start_date,
      end_date,
      force_refresh === true || force_refresh === 'true',
    );
  }

  @Post('facebook/channel-metrics')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Compute Facebook channel metrics (viral posts, ads, charts)' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['url'],
      properties: {
        url: { type: 'string', example: 'https://www.facebook.com/yourpage' },
        max_posts: { type: 'number', default: 80 },
        force_method: { type: 'string', enum: ['auto', 'graph', 'apify'], default: 'apify' },
      },
    },
  })
  async facebookChannelMetrics(@Body() body: any) {
    const { url, max_posts, force_method, start_date, end_date, force_refresh } = body || {};
    if (!url) {
      throw new HttpException('url is required', HttpStatus.BAD_REQUEST);
    }
    return this.aiService.facebookChannelMetrics(
      url,
      max_posts ?? 200,
      (force_method as any) || 'apify',
      start_date,
      end_date,
      force_refresh === true || force_refresh === 'true',
    );
  }

  @Post('channel/insights')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generic channel insights (Gemini) for all platforms' })
  async channelInsights(@Body() body: any) {
    const { platform, username, url, max_posts, language, start_date, end_date, force_refresh } = body || {};
    const user = username || url;
    if (!platform || !user) {
      throw new HttpException('platform and username/url are required', HttpStatus.BAD_REQUEST);
    }
    return this.aiService.channelInsights(platform, user, max_posts ?? 200, language || 'vi', start_date, end_date, force_refresh === true || force_refresh === 'true');
  }

  @Post('channel/metrics')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generic channel metrics (no Gemini) for all platforms' })
  async channelMetrics(@Body() body: any) {
    const { platform, username, url, max_posts, start_date, end_date, force_refresh } = body || {};
    const user = username || url;
    if (!platform || !user) {
      throw new HttpException('platform and username/url are required', HttpStatus.BAD_REQUEST);
    }
    return this.aiService.channelMetrics(platform, user, max_posts ?? 200, start_date, end_date, force_refresh === true || force_refresh === 'true');
  }

  @Get('search/history')
  @ApiOperation({ summary: 'Get search history' })
  @ApiQuery({ name: 'platform', required: false, description: 'Filter by platform' })
  @ApiQuery({ name: 'limit', required: false, description: 'Limit results', type: Number })
  @ApiResponse({ status: 200, description: 'Return search history.' })
  async getSearchHistory(
    @Query('platform') platform?: string,
    @Query('limit') limit?: number,
  ) {
    return this.aiService.getSearchHistory(platform, limit || 50);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get AI service statistics' })
  @ApiResponse({ status: 200, description: 'Return statistics.' })
  async getStats() {
    return this.aiService.getStats();
  }

  @Get('health')
  @ApiOperation({ summary: 'Check AI service health' })
  @ApiResponse({ status: 200, description: 'AI service is healthy.' })
  @ApiResponse({ status: 503, description: 'AI service is unavailable.' })
  async healthCheck() {
    return this.aiService.healthCheck();
  }

  // Collections endpoints
  @Get('collections')
  @ApiOperation({ summary: 'Get all collections' })
  async getCollections() {
    return this.aiService.getCollections();
  }

  @Post('collections')
  @ApiOperation({ summary: 'Create a new collection' })
  async createCollection(@Body() data: any) {
    return this.aiService.createCollection(data);
  }

  @Get('collections/:id')
  @ApiOperation({ summary: 'Get collection detail' })
  async getCollection(@Param('id') id: string) {
    return this.aiService.getCollection(id);
  }

  @Put('collections/:id')
  @ApiOperation({ summary: 'Update collection' })
  async updateCollection(@Param('id') id: string, @Body() data: any) {
    return this.aiService.updateCollection(id, data);
  }

  @Delete('collections/:id')
  @ApiOperation({ summary: 'Delete collection' })
  async deleteCollection(@Param('id') id: string) {
    return this.aiService.deleteCollection(id);
  }

  @Post('collections/:id/add-video')
  @ApiOperation({ summary: 'Add video to collection' })
  async addVideoToCollection(@Param('id') id: string, @Body() data: any) {
    return this.aiService.addVideoToCollection(id, data);
  }

  @Delete('collections/:id/remove-video/:videoId')
  @ApiOperation({ summary: 'Remove video from collection' })
  async removeVideoFromCollection(@Param('id') id: string, @Param('videoId') videoId: string) {
    return this.aiService.removeVideoFromCollection(id, videoId);
  }

  @Get('proxy/avatar')
  @ApiOperation({ summary: 'Proxy avatar image to bypass CORS and expiry issues' })
  @ApiQuery({ name: 'url', required: true, description: 'Original avatar URL to proxy' })
  @ApiResponse({ status: 200, description: 'Returns proxied image' })
  async proxyAvatar(@Query('url') url: string, @Res() res: Response) {
    return this.aiService.proxyAvatar(url, res);
  }

  // ═══════════════════════════════════════════════════════════════
  // Mix-Video Endpoints (Business Logic Layer)
  // ═══════════════════════════════════════════════════════════════

  // ─── NEW Smart Mix Endpoints (20-30x faster!) ───

  @Post('smart-mix')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(FileInterceptor('audio'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: '⚡ Smart Mix Video (NEW - 5-13s)',
    description: 'High-performance mix using pre-processing + lazy loading. 20-30x faster than old mix!'
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['audio'],
      properties: {
        audio: { type: 'string', format: 'binary' },
        num_outputs: { type: 'number', default: 5 },
        width: { type: 'number', default: 540 },
        height: { type: 'number', default: 960 },
        use_gpu: { type: 'string', enum: ['true', 'false', 'auto'], default: 'auto' },
        use_a4_formula: { type: 'string', enum: ['true', 'false'], default: 'false', description: 'Use A4 formula (8 slots with split layout)' },
      },
    },
  })
  @ApiResponse({
    status: 202,
    description: 'Mix started',
    schema: {
      type: 'object',
      properties: {
        progress_id: { type: 'string' },
        message: { type: 'string' }
      }
    }
  })
  async smartMix(
    @Req() req: any,
    @UploadedFile() audio: Express.Multer.File,
  ) {
    if (!audio) {
      throw new HttpException('Audio file is required', HttpStatus.BAD_REQUEST);
    }
    return this.aiService.smartMix(req.body, audio);
  }

  @Get('smart-mix/status/:progressId')
  @ApiOperation({ summary: 'Get smart mix progress status' })
  async smartMixStatus(@Param('progressId') progressId: string) {
    return this.aiService.smartMixStatus(progressId);
  }

  @Post('index-folders')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Index videos from folders (one-time setup)',
    description: 'Scan and index video metadata into database for fast mixing'
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['folders'],
      properties: {
        folders: {
          type: 'object',
          description: 'Map of folder_type to folder_path',
          example: {
            'Sản phẩm': '\\\\VCB_MEDIA\\...',
            'HuyK': '\\\\VCB_MEDIA\\...'
          }
        },
        videos_per_folder: { type: 'number', default: 50 }
      },
    },
  })
  async indexFolders(@Body() body: any) {
    return this.aiService.indexFolders(body);
  }

  @Get('cache-stats')
  @ApiOperation({ summary: 'Get cache statistics' })
  async cacheStats() {
    return this.aiService.getCacheStats();
  }

  // ─── OLD Mix Endpoints (DEPRECATED - 2-3 min, keep for fallback) ───

  @Post('scan-folder')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Scan folder to count videos' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['path'],
      properties: {
        path: { type: 'string', example: 'D:\\Videos\\Folder1' },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Returns video count',
    schema: {
      type: 'object',
      properties: {
        total_video_count: { type: 'number' },
        path: { type: 'string' }
      }
    }
  })
  async scanFolder(@Body() body: { path: string }) {
    return this.aiService.scanFolder(body.path);
  }

  @Post('mix-video')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(FileInterceptor('audio'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Manual mix video - User provides 10 folder paths',
    description: 'Mix video với 10 folder paths được user chọn thủ công (path input mode)'
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['audio'],
      properties: {
        folder_paths_0: { type: 'string', example: 'D:\\Videos\\Folder0' },
        folder_paths_1: { type: 'string', example: 'D:\\Videos\\Folder1' },
        folder_paths_2: { type: 'string' },
        folder_paths_3: { type: 'string' },
        folder_paths_4: { type: 'string' },
        folder_paths_5: { type: 'string' },
        folder_paths_6: { type: 'string' },
        folder_paths_7: { type: 'string' },
        folder_paths_8: { type: 'string' },
        folder_paths_9: { type: 'string' },
        audio: { type: 'string', format: 'binary' },
        width: { type: 'number', default: 720 },
        height: { type: 'number', default: 1280 },
        num_outputs: { type: 'number', default: 5 },
      },
    },
  })
  @ApiResponse({
    status: 202,
    description: 'Mix started successfully',
    schema: {
      type: 'object',
      properties: {
        progress_id: { type: 'string' },
        message: { type: 'string' }
      }
    }
  })
  async mixVideo(
    @Req() req: any,
    @UploadedFile() audio: Express.Multer.File,
  ) {
    if (!audio) {
      throw new HttpException('Audio file is required', HttpStatus.BAD_REQUEST);
    }
    return this.aiService.mixVideo(req.body, audio);
  }

  @Post('mix-video-auto')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(FileInterceptor('audio'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Auto mix video - BE orchestrates folder scanning and mixing',
    description: `
      BE handles business logic:
      1. Scans base folder for subfolders (Node.js)
      2. Calls AI Service to scan metadata with cache (Python/Django)
      3. Selects best 10 folders based on video count
      4. Calls AI Service to mix videos (FFmpeg)
      5. Returns progress_id for status polling
      
      This separates concerns:
      - BE: Business logic, folder selection
      - AI Service: Technical tasks (ffprobe, ffmpeg, cache)
    `
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['base_folder_path', 'audio'],
      properties: {
        base_folder_path: {
          type: 'string',
          description: 'Base folder path containing subfolders with videos',
          example: 'D:\\Videos\\MixContent'
        },
        audio: {
          type: 'string',
          format: 'binary',
          description: 'Audio file (MP3, WAV, etc.)'
        },
        num_outputs: {
          type: 'number',
          description: 'Number of output videos',
          example: 5,
          minimum: 1,
          maximum: 100
        },
        width: {
          type: 'number',
          description: 'Output width',
          example: 720
        },
        height: {
          type: 'number',
          description: 'Output height',
          example: 1280
        },
        min_videos_per_folder: {
          type: 'number',
          description: 'Minimum videos required per folder',
          example: 1
        }
      }
    }
  })
  @ApiResponse({
    status: 202,
    description: 'Mix started successfully, returns progress_id',
    schema: {
      example: {
        progress_id: 'abc123...',
        selected_folders: [
          { name: 'folder1', video_count: 25 },
          { name: 'folder2', video_count: 20 }
        ],
        total_videos: 180,
        cache_stats: { hit_rate: 95.5, cache_hits: 450, cache_misses: 20 }
      }
    }
  })
  @ApiResponse({ status: 400, description: 'Invalid parameters' })
  @ApiResponse({ status: 404, description: 'Folder not found' })
  async mixVideoAuto(
    @Body() mixDto: MixVideoAutoDto,
    @UploadedFile() audioFile: Express.Multer.File
  ) {
    if (!audioFile) {
      throw new HttpException('Audio file is required', HttpStatus.BAD_REQUEST);
    }
    return this.aiService.mixVideoAuto(mixDto, audioFile);
  }

  @Get('mix-video/status/:progressId')
  @ApiOperation({ summary: 'Check mix video progress and get results' })
  @ApiResponse({
    status: 200,
    description: 'Returns current progress and results when done',
    schema: {
      example: {
        status: 'processing',
        percent: 45,
        num_outputs: 5,
        output_urls: [],
        error: null
      }
    }
  })
  async getMixStatus(@Param('progressId') progressId: string) {
    return this.aiService.getMixStatus(progressId);
  }

  @Post('mix-video/cancel/:progressId')
  @ApiOperation({ summary: 'Cancel ongoing mix video process' })
  @ApiResponse({ status: 200, description: 'Cancellation requested successfully' })
  async cancelMix(@Param('progressId') progressId: string) {
    return this.aiService.cancelMix(progressId);
  }

  @Post('mix-video-upload')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Mix video with folder uploads - Upload videos for 10 slots' })
  @ApiBody({
    description: 'Upload videos for 10 slots (folder_0 to folder_9) and audio file',
    schema: {
      type: 'object',
      properties: {
        folder_0: { type: 'array', items: { type: 'string', format: 'binary' }, description: 'Videos for slot 0 (Sản phẩm)' },
        folder_1: { type: 'array', items: { type: 'string', format: 'binary' }, description: 'Videos for slot 1 (HuyK)' },
        folder_2: { type: 'array', items: { type: 'string', format: 'binary' }, description: 'Videos for slot 2' },
        folder_3: { type: 'array', items: { type: 'string', format: 'binary' }, description: 'Videos for slot 3' },
        folder_4: { type: 'array', items: { type: 'string', format: 'binary' }, description: 'Videos for slot 4' },
        folder_5: { type: 'array', items: { type: 'string', format: 'binary' }, description: 'Videos for slot 5' },
        folder_6: { type: 'array', items: { type: 'string', format: 'binary' }, description: 'Videos for slot 6' },
        folder_7: { type: 'array', items: { type: 'string', format: 'binary' }, description: 'Videos for slot 7' },
        folder_8: { type: 'array', items: { type: 'string', format: 'binary' }, description: 'Videos for slot 8' },
        folder_9: { type: 'array', items: { type: 'string', format: 'binary' }, description: 'Videos for slot 9 (Outtrol)' },
        audio: { type: 'string', format: 'binary', description: 'Audio file (required)' },
        width: { type: 'number', default: 720 },
        height: { type: 'number', default: 1280 },
        num_outputs: { type: 'number', default: 5 },
      },
      required: ['audio'],
    },
  })
  @ApiResponse({
    status: 202,
    description: 'Upload received, mix process started',
    schema: {
      example: {
        progress_id: 'abc123...',
        uploaded_slots: [0, 1, 2, 5, 9],
        total_videos: 127,
        estimated_time: '5-10 minutes'
      }
    }
  })
  async mixVideoUpload(@Req() req: any) {
    return this.aiService.mixVideoUpload(req);
  }
}
