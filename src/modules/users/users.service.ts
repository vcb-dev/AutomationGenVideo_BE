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

// Helper: check if roles array contains a Leader role
function hasLeaderRole(roles: UserRole[]): boolean {
  return roles.includes(UserRole.LEADER);
}

// Helper: check if roles array contains a staff role (Editor or Content)
function hasStaffRole(roles: UserRole[]): boolean {
  return roles.includes(UserRole.EDITOR) || roles.includes(UserRole.CONTENT);
}

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

    // Validate manager_id if provided
    if (createUserDto.manager_id) {
      const manager = await this.prisma.user.findUnique({
        where: { id: createUserDto.manager_id },
      });

      if (!manager || (!manager.roles.includes(UserRole.MANAGER) && !manager.roles.includes(UserRole.ADMIN))) {
        throw new BadRequestException(
          "Invalid manager_id: must reference a user with MANAGER or ADMIN role",
        );
      }
    }

    // Validate team_leader_id if provided
    if (createUserDto.team_leader_id) {
      const teamLeader = await this.prisma.user.findUnique({
        where: { id: createUserDto.team_leader_id },
      });

      if (!teamLeader || !hasLeaderRole(teamLeader.roles)) {
        throw new BadRequestException(
          "Invalid team_leader_id: must reference a user with LEADER role",
        );
      }
    }

    // Hash password
    const password_hash = createUserDto.password
      ? await bcrypt.hash(createUserDto.password, 10)
      : null;

    // Build roles array (fix operator precedence bug)
    const roles: UserRole[] = (createUserDto.roles && createUserDto.roles.length > 0)
      ? createUserDto.roles.filter((r): r is UserRole => r !== undefined && r !== null)
      : (createUserDto as any).role
        ? [(createUserDto as any).role as UserRole]
        : [];

    // Create user
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password: _password, role: _role, ...userData } = createUserDto as any;
    const user = await this.prisma.user.create({
      data: {
        ...userData,
        password_hash,
        roles,
        manager_id: createUserDto.manager_id || null,
        team_leader_id: createUserDto.team_leader_id || null,
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
        roles: true,
        team: true,
        manager_id: true,
        team_leader_id: true,
        is_active: true,
        custom_permissions: true,
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
        roles: true,
        team: true,
        manager_id: true,
        team_leader_id: true,
        is_active: true,
        custom_permissions: true,
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

    // Hash password if provided
    const updateData: any = { ...updateUserDto };
    if (updateUserDto.password) {
      updateData.password_hash = await bcrypt.hash(updateUserDto.password, 10);
      delete updateData.password;
    }

    // Handle backward compatibility: if 'role' is provided, convert to roles
    if (updateData.role && !updateData.roles) {
      updateData.roles = [updateData.role];
    }
    delete updateData.role;

    return this.prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        email: true,
        full_name: true,
        roles: true,
        manager_id: true,
        team_leader_id: true,
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

    const manager = await this.prisma.user.findUnique({
      where: { id: managerId },
    });

    console.log('👤 Manager/Leader found:', manager ? { id: manager.id, email: manager.email, roles: manager.roles } : 'NOT FOUND');

    if (!manager || (!manager.roles.includes(UserRole.MANAGER) && !manager.roles.includes(UserRole.ADMIN) && !hasLeaderRole(manager.roles))) {
      throw new BadRequestException('Only managers, admins, and leaders can view their team members');
    }

    const whereClause: any = {
      is_active: true,
    };

    if (hasLeaderRole(manager.roles) && !manager.roles.includes(UserRole.MANAGER)) {
      // Leaders see their team members
      whereClause.team_leader_id = managerId;
    } else {
      // Managers/Admins see all their assigned members
      whereClause.manager_id = managerId;
    }

    const editors = await this.prisma.user.findMany({
      where: whereClause,
      select: {
        id: true,
        email: true,
        full_name: true,
        avatar: true,
        roles: true,
        is_active: true,
        created_at: true,
      },
      orderBy: {
        created_at: 'desc',
      },
    });

    console.log('📝 Team members found:', editors.length);

    const editorsWithStats = await Promise.all(
      editors.map(async (editor) => {
        const channelWhere: any = {
          user_id: editor.id,
          is_active: true,
        };

        if (platform) {
          channelWhere.platform = platform;
        }

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

        const totalChannels = channels.length;

        const videosProduced = await (this.prisma as any).video.count({
          where: { user_id: editor.id },
        });

        const videosPosted = channels.reduce((sum, channel) => {
          const current = channel.total_videos || 0;
          const initial = (channel as any).initial_video_count || 0;
          const delta = Math.max(0, current - initial);
          return sum + delta;
        }, 0);

        const totalFollowers = channels.reduce((sum, ch) => sum + (ch.total_followers || 0), 0);
        const totalLikes = channels.reduce((sum, ch) => sum + Number(ch.total_likes), 0);
        const totalViews = channels.reduce((sum, ch) => sum + Number(ch.total_views), 0);

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
    const managers = await this.prisma.user.findMany({
      where: {
        roles: { hasSome: [UserRole.MANAGER, UserRole.LEADER] },
        is_active: true,
      },
      select: {
        id: true,
        email: true,
        full_name: true,
        avatar: true,
        roles: true,
      },
      orderBy: {
        full_name: 'asc',
      },
    });

    return managers;
  }

  async selectManager(userId: string, managerId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!hasStaffRole(user.roles) && !hasLeaderRole(user.roles)) {
      throw new BadRequestException('Only editors, content creators, and leaders can select a manager');
    }

    const manager = await this.prisma.user.findUnique({
      where: { id: managerId },
    });

    if (!manager || (!manager.roles.includes(UserRole.MANAGER) && !hasLeaderRole(manager.roles) && !manager.roles.includes(UserRole.ADMIN))) {
      throw new BadRequestException('Invalid manager/leader selected');
    }

    if (hasLeaderRole(manager.roles)) {
      const updatedUser = await this.prisma.user.update({
        where: { id: userId },
        data: { team_leader_id: managerId },
        select: {
          id: true,
          email: true,
          full_name: true,
          roles: true,
          manager_id: true,
          team_leader_id: true,
        },
      });

      return {
        message: 'Leader assigned successfully',
        user: updatedUser,
      };
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: { manager_id: managerId },
      select: {
        id: true,
        email: true,
        full_name: true,
        roles: true,
        manager_id: true,
      },
    });

    return {
      message: 'Manager assigned successfully',
      user: updatedUser,
    };
  }
}
