import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { UserRole } from "@prisma/client";
import * as bcrypt from "bcrypt";

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) { }

  async create(createUserDto: CreateUserDto) {
    // Check if email already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email: createUserDto.email },
    });

    if (existingUser) {
      throw new ConflictException("Email already exists");
    }

    // Validate manager_id for editors if provided
    if (createUserDto.role === UserRole.EDITOR && createUserDto.manager_id) {
      const manager = await this.prisma.user.findUnique({
        where: { id: createUserDto.manager_id },
      });

      if (!manager || manager.role !== UserRole.MANAGER) {
        throw new BadRequestException(
          "Invalid manager_id: must reference a user with MANAGER role",
        );
      }
    }

    // Hash password
    const password_hash = await bcrypt.hash(createUserDto.password, 10);

    // Create user
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password: _password, ...userData } = createUserDto;
    const user = await this.prisma.user.create({
      data: {
        ...userData,
        password_hash,
        // manager_id will be set if provided, otherwise null
        manager_id: createUserDto.manager_id || null,
      },
    });

    return user;
  }

  async findAll() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        full_name: true,
        role: true,
        manager_id: true,
        is_active: true,
        created_at: true,
        updated_at: true,
      },
    });
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        full_name: true,
        role: true,
        manager_id: true,
        is_active: true,
        created_at: true,
        updated_at: true,
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return user;
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    const user = await this.prisma.user.findUnique({ where: { id } });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    // If updating email, check for conflicts
    if (updateUserDto.email && updateUserDto.email !== user.email) {
      const existingUser = await this.prisma.user.findUnique({
        where: { email: updateUserDto.email },
      });

      if (existingUser) {
        throw new ConflictException("Email already exists");
      }
    }

    // Validate manager_id for editors
    if (
      updateUserDto.role === UserRole.EDITOR ||
      user.role === UserRole.EDITOR
    ) {
      const newManagerId = updateUserDto.manager_id ?? user.manager_id;
      if (!newManagerId) {
        throw new BadRequestException("manager_id is required for editors");
      }
    }

    // Hash password if provided
    const updateData: any = { ...updateUserDto };
    if (updateUserDto.password) {
      updateData.password_hash = await bcrypt.hash(updateUserDto.password, 10);
      delete updateData.password;
    }

    return this.prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        email: true,
        full_name: true,
        role: true,
        manager_id: true,
        is_active: true,
        created_at: true,
        updated_at: true,
      },
    });
  }

  async remove(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    await this.prisma.user.delete({ where: { id } });

    return { message: "User deleted successfully" };
  }

  async getMyEditors(managerId: string, platform?: string) {
    console.log('🔍 getMyEditors called with:', { managerId, platform });

    // Verify the user is a manager
    const manager = await this.prisma.user.findUnique({
      where: { id: managerId },
    });

    console.log('👤 Manager found:', manager ? { id: manager.id, email: manager.email, role: manager.role } : 'NOT FOUND');

    if (!manager || (manager.role !== UserRole.MANAGER && manager.role !== UserRole.ADMIN)) {
      throw new BadRequestException('Only managers can view their editors');
    }

    // Get all editors managed by this manager
    const editors = await this.prisma.user.findMany({
      where: {
        manager_id: managerId,
        role: UserRole.EDITOR,
        is_active: true,
      },
      select: {
        id: true,
        email: true,
        full_name: true,
        avatar: true,
        role: true,
        is_active: true,
        last_login_at: true,
        created_at: true,
      },
      orderBy: {
        created_at: 'desc',
      },
    });

    console.log('📝 Editors found:', editors.length, editors.map(e => ({ email: e.email, id: e.id })));

    // For each editor, get their channel stats
    const editorsWithStats = await Promise.all(
      editors.map(async (editor) => {
        // Build where clause for channels
        const channelWhere: any = {
          user_id: editor.id,
          is_active: true,
        };

        // Add platform filter if specified
        if (platform) {
          channelWhere.platform = platform;
        }

        // Get channels for this editor
        const channels = await this.prisma.trackedChannel.findMany({
          where: channelWhere,
          select: {
            id: true,
            platform: true,
            username: true,
            display_name: true,
            avatar_url: true,
            total_followers: true,
            total_likes: true,
            total_views: true,
            total_videos: true,
            engagement_rate: true,
            last_synced_at: true,
          },
          orderBy: {
            total_videos: 'desc',
          },
        });

        // Calculate total stats
        const totalChannels = channels.length;

        // NEW LOGIC: Calculate accurate video counts
        // Videos Produced = unique videos created by this editor
        // Cast to any because Prisma Client might not be regenerated yet
        const videosProduced = await (this.prisma as any).video.count({
          where: { user_id: editor.id },
        });

        // 2. Count Total Videos Posted (Delta logic: Current Total - Initial Count)
        // This ensures we only count videos added SINCE the editor was assigned/tracking started
        const videosPosted = channels.reduce((sum, channel) => {
          const current = channel.total_videos || 0;
          // Cast to any to access new column
          const initial = (channel as any).initial_video_count || 0;
          const delta = Math.max(0, current - initial);
          return sum + delta;
        }, 0);

        const totalFollowers = channels.reduce((sum, ch) => sum + (ch.total_followers || 0), 0);
        const totalLikes = channels.reduce((sum, ch) => sum + Number(ch.total_likes), 0);
        const totalViews = channels.reduce((sum, ch) => sum + Number(ch.total_views), 0);

        // Convert channels to DTO format
        const channelStats = channels.map(ch => ({
          id: ch.id,
          username: ch.username,
          display_name: ch.display_name,
          avatar_url: ch.avatar_url,
          total_videos: ch.total_videos,
          total_followers: ch.total_followers,
          total_likes: Number(ch.total_likes),
          total_views: Number(ch.total_views),
          engagement_rate: ch.engagement_rate,
          last_synced_at: ch.last_synced_at,
        }));

        return {
          ...editor,
          stats: {
            total_channels: totalChannels,
            total_videos_produced: videosProduced,
            total_videos_posted: videosPosted,
            total_followers: totalFollowers,
            total_likes: totalLikes,
            total_views: totalViews,
            channels: channelStats,
          },
        };
      })
    );

    return {
      editors: editorsWithStats,
      total_editors: editorsWithStats.length,
      platform_filter: platform || null,
    };
  }

  async getAvailableManagers() {
    // Get all active managers
    const managers = await this.prisma.user.findMany({
      where: {
        role: UserRole.MANAGER,
        is_active: true,
      },
      select: {
        id: true,
        email: true,
        full_name: true,
        avatar: true,
      },
      orderBy: {
        full_name: 'asc',
      },
    });

    return managers;
  }

  async selectManager(userId: string, managerId: string) {
    // Verify user exists and is an EDITOR
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.role !== UserRole.EDITOR && user.role !== UserRole.CONTENT) {
      throw new BadRequestException('Only editors and content creators can select a manager');
    }

    // Verify manager exists and is a MANAGER
    const manager = await this.prisma.user.findUnique({
      where: { id: managerId },
    });

    if (!manager || manager.role !== UserRole.MANAGER) {
      throw new BadRequestException('Invalid manager selected');
    }

    // Update user's manager_id
    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: { manager_id: managerId },
      select: {
        id: true,
        email: true,
        full_name: true,
        role: true,
        manager_id: true,
      },
    });

    return {
      message: 'Manager assigned successfully',
      user: updatedUser,
    };
  }
}

