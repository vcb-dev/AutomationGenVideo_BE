import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateTrackedChannelDto, UpdateTrackedChannelDto } from './dto/tracked-channel.dto';

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
}
