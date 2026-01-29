import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import { UploadVideoDto, CheckDuplicateResponseDto } from './dto/upload-video.dto';

@Injectable()
export class VideosService {
  private readonly logger = new Logger(VideosService.name);
  private readonly aiServiceUrl: string;
  private readonly storageBasePath: string;

  constructor(
    private prisma: PrismaService,
    private httpService: HttpService,
    private configService: ConfigService,
  ) {
    this.aiServiceUrl = this.configService.get('AI_SERVICE_URL') || 'http://localhost:8001';
    
    // Convert relative path to absolute path
    const configPath = this.configService.get('VIDEO_STORAGE_PATH') || './storage/videos';
    this.storageBasePath = path.isAbsolute(configPath) 
      ? configPath 
      : path.resolve(process.cwd(), configPath);
    
    this.logger.log(`📁 Video storage path: ${this.storageBasePath}`);
    this.logger.log(`🤖 AI Service URL: ${this.aiServiceUrl}`);
  }

  /**
   * Upload video and check for duplicates
   */
  async uploadAndCheckDuplicate(
    file: Express.Multer.File,
    userId: string,
    dto: UploadVideoDto,
  ): Promise<{ success: boolean; video?: any; duplicate?: CheckDuplicateResponseDto }> {
    const videoTitle = dto.title || file.originalname.replace(/\.[^/.]+$/, ''); // Use filename without extension if no title
    this.logger.log(`Uploading video: ${videoTitle} for user: ${userId}`);

    // 1. Save file to storage
    const filePath = await this.saveFile(file, userId);

    try {
      // 2. Generate fingerprint
      this.logger.log('Generating fingerprint...');
      const fingerprint = await this.generateFingerprint(filePath);

      // 3. Check for duplicates
      this.logger.log('Checking for duplicates...');
      const duplicateCheck = await this.checkDuplicate(filePath, dto.channelId, userId);

      if (duplicateCheck.isDuplicate) {
        // Delete uploaded file
        await fs.unlink(filePath);

        return {
          success: false,
          duplicate: duplicateCheck,
        };
      }

      // 4. Save video to database
      const video = await this.saveVideo({
        userId,
        title: videoTitle,
        description: dto.description,
        filePath,
        fingerprint,
      });

      this.logger.log(`✅ Video uploaded successfully: ${video.id}`);

      return {
        success: true,
        video,
      };
    } catch (error) {
      // Cleanup on error
      await fs.unlink(filePath).catch(() => {});
      throw error;
    }
  }

  /**
   * Save uploaded file to storage
   */
  private async saveFile(file: Express.Multer.File, userId: string): Promise<string> {
    this.logger.log(`💾 Saving file...`);
    this.logger.log(`  Storage base path: ${this.storageBasePath}`);
    this.logger.log(`  User ID: ${userId}`);
    this.logger.log(`  Original filename: ${file.originalname}`);
    
    const uploadDir = path.join(this.storageBasePath, userId);
    await fs.mkdir(uploadDir, { recursive: true });

    const filename = `${Date.now()}_${file.originalname}`;
    const filepath = path.join(uploadDir, filename);

    this.logger.log(`  Upload directory: ${uploadDir}`);
    this.logger.log(`  Final filepath: ${filepath}`);
    
    await fs.writeFile(filepath, file.buffer);

    this.logger.log(`✅ File saved successfully`);
    return filepath;
  }

  /**
   * Generate fingerprint using AI service
   */
  private async generateFingerprint(videoPath: string): Promise<any> {
    try {
      const url = `${this.aiServiceUrl}/api/duplicate-detection/generate-fingerprint/`;
      
      this.logger.log(`🔍 Generating fingerprint...`);
      this.logger.log(`  Video path: ${videoPath}`);
      this.logger.log(`  AI Service URL: ${this.aiServiceUrl}`);
      this.logger.log(`  Full endpoint: ${url}`);
      
      const { data } = await firstValueFrom(
        this.httpService.post(url, {
          video_path: videoPath,
        }),
      );

      this.logger.log(`✅ Fingerprint generated successfully`);
      return data;
    } catch (error) {
      this.logger.error(`❌ Failed to generate fingerprint: ${error.message}`);
      this.logger.error(`   Response data: ${JSON.stringify(error.response?.data)}`);
      this.logger.error(`   Status code: ${error.response?.status}`);
      throw new BadRequestException('Failed to generate video fingerprint');
    }
  }

  /**
   * Check if video is duplicate
   * Compares uploaded video against all user's videos with fingerprints
   */
  private async checkDuplicate(videoPath: string, channelId: string, userId: string): Promise<CheckDuplicateResponseDto> {
    this.logger.log(`🔍 Checking for duplicates...`);
    this.logger.log(`  Channel ID: ${channelId}`);
    
    // 1. Get channel information
    const channel = await this.prisma.trackedChannel.findUnique({
      where: { id: channelId },
      select: {
        platform: true,
        username: true,
        display_name: true,
      },
    });

    if (!channel) {
      this.logger.warn(`⚠️ Channel not found: ${channelId}`);
      throw new BadRequestException('Channel not found');
    }

    this.logger.log(`  Platform: ${channel.platform}`);
    this.logger.log(`  Username: ${channel.username}`);

    // 2. Get ALL videos with fingerprints from this user
    // We check against all user's videos, not just ones posted to this channel
    // This catches duplicates even before publishing
    const userVideos = await this.prisma.video.findMany({
      where: {
        user_id: userId,
        fingerprint: {
          isNot: null,
        },
      },
      select: {
        id: true,
        title: true,
        file_url: true,
        created_at: true,
        fingerprint: {
          select: {
            feature_vector: true,
          },
        },
      },
      orderBy: {
        created_at: 'desc',
      },
      take: 50, // Check against 50 most recent videos
    });

    this.logger.log(`  Found ${userVideos.length} videos with fingerprints in database`);

    // 3. All userVideos already have fingerprints (filtered in query)
    if (userVideos.length > 0) {
      // We have fingerprints - use them directly for comparison
      this.logger.log(`  ✅ Using ${userVideos.length} existing fingerprints for comparison`);
      
      const existingVideosData = userVideos.map(video => ({
        id: video.id,
        title: video.title,
        feature_vector: video.fingerprint.feature_vector,
        platforms: [channel.platform],
        createdAt: video.created_at,
      }));

      try {
        const { data } = await firstValueFrom(
          this.httpService.post(`${this.aiServiceUrl}/api/duplicate-detection/check-duplicate/`, {
            video_path: videoPath,
            existing_videos: existingVideosData,
          }),
        );

        this.logger.log(`  Comparison result: ${data.is_duplicate ? '🔴 DUPLICATE' : '🟢 UNIQUE'}`);
        this.logger.log(`  Similarity: ${(data.similarity * 100).toFixed(2)}%`);

        return {
          isDuplicate: data.is_duplicate,
          matchedVideo: data.matched_video
            ? {
                id: data.matched_video.id,
                title: data.matched_video.title,
                createdAt: data.matched_video.createdAt,
                platforms: data.matched_video.platforms,
              }
            : undefined,
          similarity: data.similarity,
          confidence: data.confidence,
          needsReview: data.needs_review,
        };
      } catch (error) {
        this.logger.error(`❌ Failed to compare with AI service: ${error.message}`);
        throw new BadRequestException('Failed to check video duplicate');
      }
    }

    // No videos with fingerprints yet - this is the first upload
    this.logger.log(`  ℹ️ No existing videos with fingerprints - this appears to be first upload`);
    return {
      isDuplicate: false,
      similarity: 0,
      confidence: 'high',
      needsReview: false,
    };
  }

  /**
   * Save video to database
   */
  private async saveVideo(data: {
    userId: string;
    title: string;
    description?: string;
    filePath: string;
    fingerprint: any;
  }) {
    // Create video
    const video = await this.prisma.video.create({
      data: {
        user_id: data.userId,
        title: data.title,
        description: data.description,
        file_url: data.filePath,
        duration: data.fingerprint.duration_seconds,
      },
    });

    // Create fingerprint
    await this.prisma.videoFingerprint.create({
      data: {
        video_id: video.id,
        feature_vector: data.fingerprint.feature_vector,
        duration_seconds: data.fingerprint.duration_seconds,
        frame_count: data.fingerprint.frame_count,
        resolution: data.fingerprint.resolution,
      },
    });

    // Create video group (this is a new unique video)
    const group = await this.prisma.videoGroup.create({
      data: {
        master_video_id: video.id,
        production_date: new Date(),
      },
    });

    // Create duplicate record
    await this.prisma.videoDuplicate.create({
      data: {
        group_id: group.id,
        video_id: video.id,
        status: 'UNIQUE',
        is_master: true,
        similarity_score: 1.0,
        detection_method: 'deep_learning',
        confidence_level: 'high',
      },
    });

    return video;
  }

  /**
   * Mark video as published on platforms
   */
  async markAsPublished(videoId: string, platforms: string[], publishedAt?: Date) {
    const video = await this.prisma.video.findUnique({
      where: { id: videoId },
      include: { duplicate: true },
    });

    if (!video) {
      throw new NotFoundException('Video not found');
    }

    // Create video posts for each platform
    const posts = await Promise.all(
      platforms.map((platform) =>
        this.prisma.videoPost.create({
          data: {
            video_id: video.id,
            channel_id: video.duplicate.group_id, // Use group as channel for now
            platform: platform as any,
            posted_at: publishedAt || new Date(),
          },
        }),
      ),
    );

    this.logger.log(`✅ Video ${videoId} marked as published on ${platforms.join(', ')}`);

    return { video, posts };
  }

  /**
   * Get videos for user
   */
  async getUserVideos(userId: string) {
    return this.prisma.video.findMany({
      where: { user_id: userId },
      include: {
        fingerprint: false, // Don't include large feature vectors
        duplicate: {
          select: {
            status: true,
            is_master: true,
            similarity_score: true,
          },
        },
        posts: {
          select: {
            platform: true,
            posted_at: true,
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });
  }
}
