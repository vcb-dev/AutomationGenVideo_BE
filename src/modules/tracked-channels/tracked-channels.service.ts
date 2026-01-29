import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateTrackedChannelDto, UpdateTrackedChannelDto } from './dto/tracked-channel.dto';
import { ManagerDashboardDto, PlatformStatsDto, PlatformTrendDto, TrendDataDto } from './dto/manager-dashboard.dto';
import { Platform } from '@prisma/client';

@Injectable()
export class TrackedChannelsService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, createDto: CreateTrackedChannelDto) {
    // Use upsert to handle both creation and update of stats
    const result = await this.prisma.trackedChannel.upsert({
      where: {
        user_id_platform_username: {
          user_id: userId,
          platform: createDto.platform,
          username: createDto.username,
        },
      },
      update: {
        display_name: createDto.display_name,
        avatar_url: createDto.avatar_url,
        total_followers: createDto.total_followers,
        total_likes: createDto.total_likes ? BigInt(createDto.total_likes) : undefined,
        total_views: createDto.total_views ? BigInt(createDto.total_views) : undefined,
        total_videos: createDto.total_videos,
        engagement_rate: createDto.engagement_rate,
        last_synced_at: new Date(),
        is_active: true, // Reactivate if it was deleted/inactive
      },
      create: {
        user_id: userId,
        platform: createDto.platform,
        username: createDto.username,
        display_name: createDto.display_name,
        avatar_url: createDto.avatar_url,
        total_followers: createDto.total_followers,
        total_likes: createDto.total_likes ? BigInt(createDto.total_likes) : BigInt(0),
        total_views: createDto.total_views ? BigInt(createDto.total_views) : BigInt(0),
        total_videos: createDto.total_videos || 0,
        engagement_rate: createDto.engagement_rate || 0,
      },
    });

    return {
      ...result,
      total_likes: Number(result.total_likes),
      total_views: Number(result.total_views),
    };
  }

  async findAllByUser(userId: string) {
    const channels = await this.prisma.trackedChannel.findMany({
      where: {
        user_id: userId,
        is_active: true,
      },
      orderBy: {
        created_at: 'desc',
      },
    });

    // Convert BigInt to number for JSON serialization
    return channels.map((channel) => ({
      ...channel,
      total_likes: Number(channel.total_likes),
      total_views: Number(channel.total_views),
    }));
  }

  async findOne(id: string, userId: string) {
    const channel = await this.prisma.trackedChannel.findFirst({
      where: {
        id,
        user_id: userId,
      },
    });

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    return {
      ...channel,
      total_likes: Number(channel.total_likes),
      total_views: Number(channel.total_views),
    };
  }

  async findByUsername(platform: string, username: string, userId: string) {
    const channel = await this.prisma.trackedChannel.findFirst({
      where: {
        platform: platform as any, // Cast to Platform enum
        username,
        user_id: userId,
        is_active: true,
      },
    });

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    return {
      ...channel,
      total_likes: Number(channel.total_likes),
      total_views: Number(channel.total_views),
    };
  }

  async update(id: string, userId: string, updateDto: UpdateTrackedChannelDto) {
    await this.findOne(id, userId); // Check ownership

    const updated = await this.prisma.trackedChannel.update({
      where: { id },
      data: {
        ...updateDto,
        total_likes: updateDto.total_likes ? BigInt(updateDto.total_likes) : undefined,
        total_views: updateDto.total_views ? BigInt(updateDto.total_views) : undefined,
        last_synced_at: new Date(),
      },
    });

    return {
      ...updated,
      total_likes: Number(updated.total_likes),
      total_views: Number(updated.total_views),
    };
  }

  async remove(id: string, userId: string) {
    await this.findOne(id, userId); // Check ownership

    return this.prisma.trackedChannel.delete({
      where: { id },
    });
  }

  async getManagerDashboard(userId: string): Promise<ManagerDashboardDto> {
    // Get all tracked channels across all users (manager can see everything)
    const allChannels = await this.prisma.trackedChannel.findMany({
      where: {
        is_active: true,
      },
      orderBy: {
        last_synced_at: 'desc',
      },
    });

    // Group by platform
    const platformGroups = allChannels.reduce((acc, channel) => {
      if (!acc[channel.platform]) {
        acc[channel.platform] = [];
      }
      acc[channel.platform].push(channel);
      return acc;
    }, {} as Record<Platform, typeof allChannels>);

    // Calculate platform stats
    const platformStats: PlatformStatsDto[] = Object.entries(platformGroups).map(
      ([platform, channels]) => {
        const totalLikes = channels.reduce((sum, ch) => sum + Number(ch.total_likes), 0);
        const totalViews = channels.reduce((sum, ch) => sum + Number(ch.total_views), 0);
        const totalVideos = channels.reduce((sum, ch) => sum + ch.total_videos, 0);
        const avgEngagementRate =
          channels.reduce((sum, ch) => sum + ch.engagement_rate, 0) / channels.length || 0;

        return {
          platform: platform as Platform,
          totalChannels: channels.length,
          totalVideos,
          totalLikes,
          totalViews,
          totalComments: 0, // We don't track comments separately yet
          avgEngagementRate: Math.round(avgEngagementRate * 100) / 100,
        };
      },
    );

    // Generate trend data (mock for now - in real app, you'd query historical data)
    const platformTrends: PlatformTrendDto[] = Object.entries(platformGroups).map(
      ([platform, channels]) => {
        // Generate 30 days of mock trend data
        const trends: TrendDataDto[] = [];
        const now = new Date();
        
        for (let i = 29; i >= 0; i--) {
          const date = new Date(now);
          date.setDate(date.getDate() - i);
          
          // Mock data with some growth pattern
          const dayFactor = (30 - i) / 30; // Growth factor
          const randomFactor = 0.8 + Math.random() * 0.4; // Random variation
          
          const totalLikes = channels.reduce((sum, ch) => sum + Number(ch.total_likes), 0);
          const totalViews = channels.reduce((sum, ch) => sum + Number(ch.total_views), 0);
          
          trends.push({
            date: date.toISOString().split('T')[0],
            likes: Math.floor(totalLikes * dayFactor * randomFactor),
            views: Math.floor(totalViews * dayFactor * randomFactor),
            comments: Math.floor((totalLikes * 0.1) * dayFactor * randomFactor),
          });
        }

        // Calculate growth percentages (last 7 days vs previous 7 days)
        const last7Days = trends.slice(-7);
        const previous7Days = trends.slice(-14, -7);
        
        const last7Likes = last7Days.reduce((sum, t) => sum + t.likes, 0);
        const prev7Likes = previous7Days.reduce((sum, t) => sum + t.likes, 0);
        const likesGrowth = prev7Likes > 0 ? ((last7Likes - prev7Likes) / prev7Likes) * 100 : 0;
        
        const last7Views = last7Days.reduce((sum, t) => sum + t.views, 0);
        const prev7Views = previous7Days.reduce((sum, t) => sum + t.views, 0);
        const viewsGrowth = prev7Views > 0 ? ((last7Views - prev7Views) / prev7Views) * 100 : 0;
        
        const last7Comments = last7Days.reduce((sum, t) => sum + t.comments, 0);
        const prev7Comments = previous7Days.reduce((sum, t) => sum + t.comments, 0);
        const commentsGrowth = prev7Comments > 0 ? ((last7Comments - prev7Comments) / prev7Comments) * 100 : 0;

        return {
          platform: platform as Platform,
          trends,
          likesGrowth: Math.round(likesGrowth * 100) / 100,
          viewsGrowth: Math.round(viewsGrowth * 100) / 100,
          commentsGrowth: Math.round(commentsGrowth * 100) / 100,
        };
      },
    );

    return {
      platformStats,
      platformTrends,
      totalChannelsAcrossAllPlatforms: allChannels.length,
      totalVideosAcrossAllPlatforms: allChannels.reduce((sum, ch) => sum + ch.total_videos, 0),
    };
  }

  async getChannelsByPlatform(platform: string) {
    const channels = await this.prisma.trackedChannel.findMany({
      where: {
        platform: platform.toUpperCase() as any,
        is_active: true,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            full_name: true,
            role: true,
          },
        },
      },
      orderBy: {
        total_followers: 'desc',
      },
    });

    return channels.map((channel) => ({
      ...channel,
      total_likes: Number(channel.total_likes),
      total_views: Number(channel.total_views),
    }));
  }

  async getAllChannels() {
    const channels = await this.prisma.trackedChannel.findMany({
      where: {
        is_active: true,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            full_name: true,
            role: true,
          },
        },
      },
      orderBy: [
        { platform: 'asc' },
        { total_followers: 'desc' },
      ],
    });

    return channels.map((channel) => ({
      ...channel,
      total_likes: Number(channel.total_likes),
      total_views: Number(channel.total_views),
    }));
  }

  async getChannelHashtagStats(channelId: string, forceRefresh: boolean = false) {
    const COMPANY_HASHTAGS = ['a1', 'a2', 'a3', 'a4', 'a5'];

    // Get channel details to send username/platform instead of ID
    const channel = await this.prisma.trackedChannel.findUnique({
      where: { id: channelId }
    });

    if (!channel) {
      throw new NotFoundException(`Channel with ID ${channelId} not found`);
    }

    try {
      // Call AI service to get hashtag stats for this channel
      // Use POST if forceRefresh is true to trigger video fetch
      const method = forceRefresh ? 'POST' : 'GET';
      // URL no longer includes ID
      const url = `${process.env.AI_SERVICE_URL}/api/videos/channel-hashtag-stats/`;
      
      console.log(`[TrackedChannels] Calling AI Service: ${method} ${url} for ${channel.username}`);
      
      const payload = {
        username: channel.username,
        platform: channel.platform,
      };

      // For GET, use query params. For POST, use body.
      let fetchUrl = url;
      let body = undefined;

      if (method === 'GET') {
          const params = new URLSearchParams(payload as any);
          fetchUrl = `${url}?${params.toString()}`;
      } else {
          body = JSON.stringify(payload);
      }

      const response = await fetch(
        fetchUrl,
        {
          method,
          headers: {
            'Content-Type': 'application/json',
          },
          body
        }
      );

      console.log(`[TrackedChannels] AI Service Response: ${response.status} ${response.statusText}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[TrackedChannels] Error Details: ${errorText}`);
        throw new Error(`AI service returned ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      
      return {
        channel_id: channelId,
        total_videos: data.total_videos || 0,
        hashtag_stats: data.hashtag_stats || COMPANY_HASHTAGS.map(tag => ({
          hashtag: tag,
          count: 0,
          percentage: 0,
        })),
        message: data.message || null,
      };
    } catch (error) {
      console.error('Error fetching channel hashtag stats:', error);
      
      // Return empty stats on error
      return {
        channel_id: channelId,
        total_videos: 0,
        hashtag_stats: COMPANY_HASHTAGS.map(tag => ({
          hashtag: tag,
          count: 0,
          percentage: 0,
        })),
        error: 'Failed to fetch hashtag statistics',
      };
    }
  }
}
