import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import { CacheService } from "../../common/cache/cache.service";
import { GoogleDriveStorageService } from "../social-publishing/upload/google-drive-storage.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { UserRole } from "@prisma/client";
import * as bcrypt from "bcrypt";
import * as fs from "fs";
import { LarkService } from "../lark-sync/lark.service";

// Helper: check if roles array contains a staff role (MEMBER)
function hasStaffRole(roles: UserRole[]): boolean {
  return roles.includes(UserRole.MEMBER);
}

/** Sau khi thêm image_url vào User — nếu TS báo lỗi select, chạy: npx prisma generate (tắt dev server nếu EPERM trên Windows). */
type UserWithImageSelect = {
  id: string;
  email: string;
  full_name: string;
  image_url: string | null;
  roles: UserRole[];
};

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private prisma: PrismaService,
    private larkService: LarkService,
    private cacheService: CacheService,
    private googleDrive: GoogleDriveStorageService,
  ) { }

  private userCacheKey(id: string) { return `user:id:${id}`; }
  private userEmailCacheKey(email: string) { return `user:email:${email.toLowerCase()}`; }

  async create(createUserDto: CreateUserDto) {
    if (createUserDto.email) {
      createUserDto.email = createUserDto.email.toLowerCase();
    }
    // Check if email already exists
    const existingUser = await this.prisma.user.findFirst({
      where: { email: { equals: createUserDto.email, mode: 'insensitive' } },
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

      if (!teamLeader || (!teamLeader.roles.includes(UserRole.LEADER) && !teamLeader.roles.includes(UserRole.MANAGER) && !teamLeader.roles.includes(UserRole.ADMIN))) {
        throw new BadRequestException(
          "Invalid team_leader_id: must reference a user with LEADER, MANAGER or ADMIN role",
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
    const { password: _password, role: _role, avatar: _a, ...userData } = createUserDto as any;
    const img = (createUserDto as any).image_url ?? (createUserDto as any).avatar;
    const user = await this.prisma.user.create({
      data: {
        ...userData,
        ...(img != null ? { image_url: img } : {}),
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
    const key = this.userEmailCacheKey(email);
    return this.cacheService.get(key, 30_000, () =>
      this.prisma.user.findFirst({
        where: { email: { equals: email.toLowerCase(), mode: 'insensitive' } },
      }),
    );
  }

  /** Ghi đè password_hash bằng bcrypt (dùng sau khi login legacy plain-text). */
  async rehashPasswordFromPlain(userId: string, plainPassword: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { password_hash: await bcrypt.hash(plainPassword, 10) },
    });
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    if (updateUserDto.email) {
      updateUserDto.email = updateUserDto.email.toLowerCase();
    }
    const user = await this.prisma.user.findUnique({ where: { id } });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    // If updating email, check for conflicts
    if (updateUserDto.email && updateUserDto.email !== user.email) {
      const existingUser = await this.prisma.user.findFirst({
        where: { email: { equals: updateUserDto.email, mode: 'insensitive' } },
      });

      if (existingUser) {
        throw new ConflictException("Email already exists");
      }
    }

    // Hash password if provided
    const updateData: any = { ...updateUserDto };
    if ((updateUserDto as any).avatar != null && updateData.image_url == null) {
      updateData.image_url = (updateUserDto as any).avatar;
    }
    delete updateData.avatar;
    if (updateUserDto.password) {
      updateData.password_hash = await bcrypt.hash(updateUserDto.password, 10);
      delete updateData.password;
    }

    // Handle backward compatibility: if 'role' is provided, convert to roles
    if (updateData.role && !updateData.roles) {
      updateData.roles = [updateData.role];
    }
    delete updateData.role;

    // --- Cross-table sync ---
    const nameChanged = updateUserDto.full_name && updateUserDto.full_name !== user.full_name;
    const teamChanged = updateUserDto.team !== undefined && updateUserDto.team !== user.team;
    const emailChanged = updateUserDto.email && updateUserDto.email !== user.email;

    const oldEmail = user.email;
    const oldName = user.full_name;
    const newName = updateUserDto.full_name ?? user.full_name;
    const newTeam = updateUserDto.team ?? user.team;
    const newEmail = updateUserDto.email ?? user.email;

    // Run main update + sync in transaction
    const [updatedUser] = await this.prisma.$transaction(async (tx) => {
      const result = await tx.user.update({
        where: { id },
        data: {
          ...updateUserDto,
          last_app_update_at: new Date(),
        },
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

      // Sync LarkReport (match by email hoặc name)
      if (nameChanged || teamChanged || emailChanged) {
        const larkReportWhere: any = {};
        if (oldEmail) larkReportWhere.email = oldEmail;

        if (oldEmail || oldName) {
          await tx.larkReport.updateMany({
            where: oldEmail ? { email: oldEmail } : { name: oldName },
            data: {
              ...(nameChanged ? { name: newName } : {}),
              ...(teamChanged ? { team: newTeam } : {}),
              ...(emailChanged ? { email: newEmail } : {}),
            },
          });

          // Sync LarkReportKPI
          await tx.larkReportKPI.updateMany({
            where: oldEmail ? { email: oldEmail } : { name: oldName },
            data: {
              ...(nameChanged ? { name: newName } : {}),
              ...(teamChanged ? { team: newTeam } : {}),
              ...(emailChanged ? { email: newEmail } : {}),
            },
          });

          // Sync LarkListTask (match by email or name)
          await tx.larkListTask.updateMany({
            where: oldEmail ? { employee_email: oldEmail } : { employee_name: oldName },
            data: {
              ...(nameChanged ? { employee_name: newName } : {}),
              ...(teamChanged ? { team: newTeam } : {}),
              ...(emailChanged ? { employee_email: newEmail } : {}),
            },
          });

          // Sync LarkKPI (match by name)
          if (nameChanged || teamChanged) {
            await tx.larkKPI.updateMany({
              where: { name: oldName },
              data: {
                ...(nameChanged ? { name: newName } : {}),
                ...(teamChanged ? { team: newTeam } : {}),
              },
            });
          }

          // Sync Lark fields on users (rows linked to Lark employee)
          if (nameChanged || teamChanged) {
            await (tx.user as any).updateMany({
              where: {
                full_name: oldName,
                lark_employee_record_id: { not: null },
              },
              data: {
                ...(nameChanged ? { full_name: newName } : {}),
                ...(teamChanged ? { team: newTeam } : {}),
              },
            });
          }
        }
      }

      return [result];
    });

    // --- Fire-and-forget với Retry: Push lên Lark sau khi DB đã cập nhật ---
    if (nameChanged || teamChanged || emailChanged) {
      const pushParams = {
        oldName,
        oldEmail,
        ...(nameChanged ? { newName } : {}),
        ...(teamChanged ? { newTeam } : {}),
        ...(emailChanged ? { newEmail } : {}),
      };

      // Chạy nền (không chặn response), retry tối đa 3 lần
      this.larkService
        .withRetry(
          () => this.larkService.pushUserChangesToLark(pushParams),
          3,
          `pushUserChangesToLark(${oldEmail || oldName})`,
        )
        .then(() =>
          this.logger.log(`[LarkSync] ✅ Push lên Lark thành công cho: ${oldEmail || oldName}`),
        )
        .catch(err =>
          this.logger.error(
            `[LarkSync] ❌ Push lên Lark thất bại sau 3 lần thử cho: ${oldEmail || oldName}`,
            err.message,
          ),
        );
    }

    // Invalidate caches so JWT validation gets fresh data
    this.cacheService.invalidate(this.userCacheKey(id));
    this.cacheService.invalidate(this.userEmailCacheKey(updatedUser.email ?? ''));
    if (user.email !== updatedUser.email) {
      this.cacheService.invalidate(this.userEmailCacheKey(user.email ?? ''));
    }

    return updatedUser;
  }

  async remove(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    await this.prisma.user.delete({ where: { id } });

    this.cacheService.invalidate(this.userCacheKey(id));
    this.cacheService.invalidate(this.userEmailCacheKey(user.email ?? ''));
    this.cacheService.invalidate(`jwt:user:${id}`);

    return { message: "User deleted successfully" };
  }

  async getMyEditors(managerId: string, platform?: string) {
    console.log('🔍 getMyEditors called with:', { managerId, platform });

    const manager = await this.prisma.user.findUnique({
      where: { id: managerId },
    });

    console.log('👤 Manager found:', manager ? { id: manager.id, email: manager.email, roles: manager.roles } : 'NOT FOUND');

    if (!manager || (!manager.roles.includes(UserRole.MANAGER) && !manager.roles.includes(UserRole.ADMIN))) {
      throw new BadRequestException('Only managers and admins can view their team members');
    }

    const whereClause: any = {
      is_active: true,
    };

    // Managers/Admins see all their assigned members
    whereClause.manager_id = managerId;

    const editors = (await this.prisma.user.findMany({
      where: whereClause,
      select: {
        id: true,
        email: true,
        full_name: true,
        image_url: true,
        roles: true,
        is_active: true,
        created_at: true,
      } as any,
      orderBy: {
        created_at: 'desc',
      },
    })) as unknown as Array<
      UserWithImageSelect & { is_active: boolean; created_at: Date }
    >;

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
          avatar: editor.image_url,
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
    const managers = (await this.prisma.user.findMany({
      where: {
        roles: { hasSome: [UserRole.MANAGER, UserRole.ADMIN] },
        is_active: true,
      },
      select: {
        id: true,
        email: true,
        full_name: true,
        image_url: true,
        roles: true,
      } as any,
      orderBy: {
        full_name: 'asc',
      },
    })) as unknown as UserWithImageSelect[];

    return managers.map((m) => ({ ...m, avatar: m.image_url }));
  }

  async selectManager(userId: string, managerId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!hasStaffRole(user.roles)) {
      throw new BadRequestException('Only members can select a manager');
    }

    const manager = await this.prisma.user.findUnique({
      where: { id: managerId },
    });

    if (!manager || (!manager.roles.includes(UserRole.MANAGER) && !manager.roles.includes(UserRole.ADMIN))) {
      throw new BadRequestException('Invalid manager selected');
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

  /** Lấy danh sách nhân sự theo role của người gọi */
  async getTeamMembers(callerId: string, callerRoles: UserRole[]) {
    const selectFields = {
      id: true,
      email: true,
      full_name: true,
      roles: true,
      team: true,
      manager_id: true,
      team_leader_id: true,
      is_active: true,
      image_url: true,
      employee_id: true,
      employee_position: true,
      created_at: true,
      updated_at: true,
    };

    if (callerRoles.includes(UserRole.ADMIN) || callerRoles.includes(UserRole.MANAGER)) {
      return this.prisma.user.findMany({
        where: { id: { not: callerId } },
        select: selectFields as any,
        orderBy: { created_at: 'desc' },
      });
    }

    if (callerRoles.includes(UserRole.LEADER)) {
      return this.prisma.user.findMany({
        where: { team_leader_id: callerId },
        select: selectFields as any,
        orderBy: { created_at: 'desc' },
      });
    }

    return [];
  }

  /** Tạo nhân sự (MANAGER=ADMIN có full quyền, LEADER chỉ tạo MEMBER) */
  async createHR(callerId: string, callerRoles: UserRole[], dto: CreateUserDto) {
    const isManagerOrAdmin = callerRoles.includes(UserRole.ADMIN) || callerRoles.includes(UserRole.MANAGER);
    const isLeader = callerRoles.includes(UserRole.LEADER);

    if (!isManagerOrAdmin && isLeader) {
      const requestedRoles: UserRole[] = dto.roles?.length
        ? dto.roles
        : dto.role ? [dto.role] : [];

      if (requestedRoles.some(r => r !== UserRole.MEMBER)) {
        throw new ForbiddenException('Leader chỉ được tạo MEMBER');
      }
      dto.team_leader_id = callerId;
    }

    return this.create(dto);
  }

  /** Cập nhật nhân sự (MANAGER=ADMIN full quyền, LEADER chỉ member team mình) */
  async updateHR(callerId: string, callerRoles: UserRole[], targetId: string, dto: UpdateUserDto) {
    const isManagerOrAdmin = callerRoles.includes(UserRole.ADMIN) || callerRoles.includes(UserRole.MANAGER);
    const isLeader = callerRoles.includes(UserRole.LEADER);

    if (!isManagerOrAdmin && isLeader) {
      const target = await this.prisma.user.findUnique({ where: { id: targetId } });
      if (!target) throw new NotFoundException(`User ${targetId} not found`);

      if (target.team_leader_id !== callerId) {
        throw new ForbiddenException('Leader chỉ được cập nhật member trong team mình');
      }
      if (dto.roles || (dto as any).role) {
        throw new ForbiddenException('Leader không được thay đổi role');
      }
    }

    return this.update(targetId, dto);
  }

  /** Vô hiệu hóa tài khoản (soft delete) */
  async deactivate(callerId: string, callerRoles: UserRole[], targetId: string) {
    const isManagerOrAdmin = callerRoles.includes(UserRole.ADMIN) || callerRoles.includes(UserRole.MANAGER);
    const isLeader = callerRoles.includes(UserRole.LEADER);

    const target = await this.prisma.user.findUnique({ where: { id: targetId } });
    if (!target) throw new NotFoundException(`User ${targetId} not found`);

    if (callerId === targetId) {
      throw new ForbiddenException('Không thể vô hiệu hóa tài khoản của chính mình');
    }

    if (!isManagerOrAdmin && isLeader) {
      if (target.team_leader_id !== callerId) {
        throw new ForbiddenException('Leader chỉ được vô hiệu hóa member trong team mình');
      }
    }

    const updated = await this.prisma.user.update({
      where: { id: targetId },
      data: { is_active: false },
      select: { id: true, email: true, full_name: true, is_active: true },
    });

    this.cacheService.invalidate(this.userCacheKey(targetId));
    this.cacheService.invalidate(this.userEmailCacheKey(target.email ?? ''));

    return { message: 'Tài khoản đã được vô hiệu hóa', user: updated };
  }

  /** Kích hoạt lại tài khoản */
  async reactivate(callerId: string, callerRoles: UserRole[], targetId: string) {
    const isManagerOrAdmin = callerRoles.includes(UserRole.ADMIN) || callerRoles.includes(UserRole.MANAGER);
    const isLeader = callerRoles.includes(UserRole.LEADER);

    const target = await this.prisma.user.findUnique({ where: { id: targetId } });
    if (!target) throw new NotFoundException(`User ${targetId} not found`);

    if (!isManagerOrAdmin && isLeader) {
      if (target.team_leader_id !== callerId) {
        throw new ForbiddenException('Leader chỉ được kích hoạt member trong team mình');
      }
    }

    const updated = await this.prisma.user.update({
      where: { id: targetId },
      data: { is_active: true },
      select: { id: true, email: true, full_name: true, is_active: true },
    });

    this.cacheService.invalidate(this.userCacheKey(targetId));
    this.cacheService.invalidate(this.userEmailCacheKey(target.email ?? ''));

    return { message: 'Tài khoản đã được kích hoạt', user: updated };
  }

  /**
   * Upload avatar for user and store in Google Drive (portraits bucket)
   * Returns the permanent URL
   */
  async uploadAvatar(userId: string, file: Express.Multer.File) {
    this.logger.log(`[UploadAvatar] User ${userId} uploading avatar: ${file.originalname}`);

    // Validate user exists
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, full_name: true, image_url: true },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    if (!this.googleDrive.isAvailable()) {
      throw new BadRequestException('Google Drive storage is not configured');
    }

    try {
      // Generate clean filename
      const timestamp = Date.now();
      const ext = file.originalname.split('.').pop()?.toLowerCase() || 'jpg';
      const cleanName = user.email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '_');
      const filename = `avatar_${cleanName}_${timestamp}.${ext}`;

      // Upload to Google Drive
      const uploaded = await this.googleDrive.uploadFromPath(
        file.path,
        filename,
        file.mimetype,
        { id: userId, email: user.email }
      );

      // Update user record with new avatar URL
      const updatedUser = await this.prisma.user.update({
        where: { id: userId },
        data: { 
          image_url: uploaded.url,
          last_app_update_at: new Date(),
        },
        select: {
          id: true,
          email: true,
          full_name: true,
          image_url: true,
        },
      });

      // Invalidate cache
      this.cacheService.invalidate(this.userCacheKey(userId));
      this.cacheService.invalidate(this.userEmailCacheKey(user.email));

      this.logger.log(`[UploadAvatar] ✅ Avatar uploaded successfully for user ${userId}: ${uploaded.url}`);

      // Clean up temp file
      try {
        fs.unlinkSync(file.path);
      } catch (err) {
        this.logger.warn(`[UploadAvatar] Failed to delete temp file ${file.path}: ${err}`);
      }

      return {
        success: true,
        image_url: uploaded.url,
        message: 'Avatar uploaded successfully',
        user: updatedUser,
      };
    } catch (error) {
      this.logger.error(`[UploadAvatar] ❌ Failed to upload avatar for user ${userId}:`, error);

      // Clean up temp file on error
      try {
        fs.unlinkSync(file.path);
      } catch {}

      throw new BadRequestException(`Failed to upload avatar: ${error.message}`);
    }
  }
}
