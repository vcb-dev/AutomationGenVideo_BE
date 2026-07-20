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
import {
  getUserTeamIds,
  assignUserToTeams,
  clearUserTeams,
  isUserUnassigned,
  isTeamLeaderOfUser,
  assignUserToTeamsByName,
  replaceUserTeamsByName,
  TEAM_TX_OPTIONS,
} from "../../common/utils/team-membership.util";

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

    // Create user — strip cả team/team_leader_id khỏi spread: đây là field phái sinh từ
    // Team/TeamMember, client không được ghi trực tiếp (các luồng HR gán team riêng sau khi tạo).
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password: _password, role: _role, avatar: _a, team: _team, ...userData } = createUserDto as any;
    const img = (createUserDto as any).image_url ?? (createUserDto as any).avatar;
    const user = await this.prisma.user.create({
      data: {
        ...userData,
        ...(img != null ? { image_url: img } : {}),
        password_hash,
        roles,
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
        roles: true,
        team: true,
        manager_id: true,
        is_active: true,
        created_at: true,
        updated_at: true,
      },
    });
  }

  async findOne(id: string) {
    // Prisma @db.Uuid throws opaque "Inconsistent column data" on bad ids
    // (e.g. "undefined", "team") — reject early with a clear 400.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      throw new BadRequestException(`Invalid user id: expected UUID, got "${id}"`);
    }

    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        full_name: true,
        roles: true,
        team: true,
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

    // team là field PHÁI SINH từ Team/TeamMember (xem team-membership.util.ts) — cùng invariant
    // với create(): không bao giờ ghi trực tiếp từ dto. Đổi team phải đi qua updateHR →
    // replaceUserTeamsByName; ghi thẳng ở đây từng làm users.team lệch khỏi team_members
    // (thành viên biến mất khỏi trang hiệu suất dù trang đội nhóm vẫn đủ).
    delete updateData.team;

    // --- Cross-table sync ---
    // !== undefined (not a truthy check): an explicit full_name: "" must still be treated as a
    // change and synced to Lark, otherwise the users table and Lark tables end up out of sync.
    const nameChanged = updateUserDto.full_name !== undefined && updateUserDto.full_name !== user.full_name;
    const emailChanged = updateUserDto.email && updateUserDto.email !== user.email;

    const oldEmail = user.email;
    const oldName = user.full_name;
    const newName = updateUserDto.full_name ?? user.full_name;
    const newEmail = updateUserDto.email ?? user.email;

    // Run main update + sync in transaction.
    // Timeout mặc định của Prisma interactive transaction (5s) không đủ khi đổi team/tên kéo
    // theo updateMany trên nhiều bảng Lark (checklist_reports, report_kpi, reported_tasks, kpi)
    // với DB ở xa (Supabase Tokyo) — xem cùng lý do ở team-membership.util.ts.
    const [updatedUser] = await this.prisma.$transaction(async (tx) => {
      const result = await tx.user.update({
        where: { id },
        data: {
          ...updateData,
        },
        select: {
          id: true,
          email: true,
          full_name: true,
          roles: true,
          team: true,
          manager_id: true,
          is_active: true,
          created_at: true,
          updated_at: true,
        },
      });

      // Sync ChecklistReport (match by email hoặc name).
      // Team KHÔNG sync ở đây nữa — update() không còn nhận đổi team (field phái sinh);
      // đổi team đi qua updateHR → replaceUserTeamsByName → syncTeamAcrossLarkTables
      // với giá trị phái sinh ĐÃ tính lại, thay vì giá trị thô từ client.
      if (nameChanged || emailChanged) {
        if (oldEmail || oldName) {
          await tx.checklistReport.updateMany({
            where: oldEmail ? { email: oldEmail } : { name: oldName },
            data: {
              ...(nameChanged ? { name: newName } : {}),
              ...(emailChanged ? { email: newEmail } : {}),
            },
          });

          // Sync ReportKpi
          await tx.reportKpi.updateMany({
            where: oldEmail ? { email: oldEmail } : { name: oldName },
            data: {
              ...(nameChanged ? { name: newName } : {}),
              ...(emailChanged ? { email: newEmail } : {}),
            },
          });

          // Sync ReportedTask (match by email or name)
          await tx.reportedTask.updateMany({
            where: oldEmail ? { employee_email: oldEmail } : { employee_name: oldName },
            data: {
              ...(nameChanged ? { employee_name: newName } : {}),
              ...(emailChanged ? { employee_email: newEmail } : {}),
            },
          });

          // Sync Kpi (match by name)
          if (nameChanged) {
            await tx.kpi.updateMany({
              where: { name: oldName },
              data: { name: newName },
            });
          }

          // Sync Lark fields on users (rows linked to Lark employee)
          if (nameChanged) {
            await (tx.user as any).updateMany({
              where: {
                full_name: oldName,
                lark_employee_record_id: { not: null },
              },
              data: { full_name: newName },
            });
          }
        }
      }

      return [result];
    }, TEAM_TX_OPTIONS);

    // Invalidate caches so JWT validation gets fresh data
    this.cacheService.invalidate(this.userCacheKey(id));
    this.cacheService.invalidate(this.userEmailCacheKey(updatedUser.email ?? ''));
    if (user.email !== updatedUser.email) {
      this.cacheService.invalidate(this.userEmailCacheKey(user.email ?? ''));
    }
    // Trang checklist/hiệu suất cache 5' theo prefix 'activity:' — đổi team/status/tên phải thấy ngay
    this.cacheService.invalidate('activity:');

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
    // User xóa cứng phải biến mất ngay khỏi trang checklist (cache 'activity:' TTL 5')
    this.cacheService.invalidate('activity:');

    return { message: "User deleted successfully" };
  }

  async getMyEditors(managerId: string, platform?: string) {
    const manager = await this.prisma.user.findUnique({
      where: { id: managerId },
    });

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

  async getAvailableLeaders() {
    const leaders = await this.prisma.user.findMany({
      where: {
        roles: { has: UserRole.LEADER },
        is_active: true,
      },
      select: {
        id: true,
        email: true,
        full_name: true,
        image_url: true,
        roles: true,
        team: true,
        manager_id: true,
        is_active: true,
        employee_id: true,
        employee_position: true,
        created_at: true,
        updated_at: true,
      },
      orderBy: {
        full_name: 'asc',
      },
    });

    return leaders;
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
      is_active: true,
      image_url: true,
      employee_id: true,
      employee_position: true,
      created_at: true,
      updated_at: true,
    };

    if (callerRoles.includes(UserRole.ADMIN) || callerRoles.includes(UserRole.MANAGER)) {
      return this.prisma.user.findMany({
        where: { id: { not: callerId }, deleted_at: null },
        select: selectFields as any,
        orderBy: { created_at: 'desc' },
      });
    }

    if (callerRoles.includes(UserRole.LEADER)) {
      // Find all teams led by this leader
      const ledTeams = await this.prisma.team.findMany({
        where: { leader_id: callerId },
        select: { name: true },
      });
      const ledTeamNames = ledTeams.map((t) => t.name.trim());
      if (ledTeamNames.length === 0) return [];

      // Construct a query to match any user whose 'team' string contains or equals any of the ledTeamNames
      const OR = ledTeamNames.flatMap((name) => [
        { team: { equals: name, mode: 'insensitive' as any } },
        { team: { startsWith: `${name},`, mode: 'insensitive' as any } },
        { team: { endsWith: `,${name}`, mode: 'insensitive' as any } },
        { team: { contains: `,${name},`, mode: 'insensitive' as any } },
      ]);

      return this.prisma.user.findMany({
        where: {
          id: { not: callerId },
          OR,
          deleted_at: null,
        },
        select: selectFields as any,
        orderBy: { created_at: 'desc' },
      });
    }

    return [];
  }

  /**
   * Nhân sự chưa được gán team (vd: vừa đăng nhập Gmail lần đầu).
   * ADMIN/MANAGER/LEADER đều thấy chung pool này để "nhận" về team mình —
   * khác với getTeamMembers (LEADER chỉ thấy member ĐÃ thuộc team mình).
   */
  async getUnassignedMembers() {
    // Thay cho where: { team: null } — "chưa gán team" giờ nghĩa là không có TeamMember nào.
    const assignedUserIds = (
      await this.prisma.teamMember.findMany({ select: { user_id: true }, distinct: ['user_id'] })
    ).map((m) => m.user_id);
    return this.prisma.user.findMany({
      where: { id: { notIn: assignedUserIds }, deleted_at: null },
      select: {
        id: true,
        email: true,
        full_name: true,
        roles: true,
        team: true,
        manager_id: true,
        is_active: true,
        image_url: true,
        employee_id: true,
        employee_position: true,
        created_at: true,
        updated_at: true,
      },
      orderBy: { created_at: 'desc' },
    });
  }

  /**
   * Với role không phải LEADER, mọi tên team trong multi-select phải tồn tại sẵn — validate
   * TRƯỚC khi ghi bất cứ thứ gì để lỗi không để lại dữ liệu dở dang (user mồ côi, User.team ma).
   */
  private async assertAssignableTeamNames(teamNamesRaw: string, roles: UserRole[]) {
    if (roles.includes(UserRole.LEADER)) return;
    const names = teamNamesRaw.split(',').map((s) => s.trim()).filter(Boolean);
    if (!names.length) return;
    const found = await this.prisma.team.findMany({ where: { name: { in: names } }, select: { name: true } });
    const foundNames = new Set(found.map((t) => t.name));
    const missing = names.filter((n) => !foundNames.has(n));
    if (missing.length) {
      throw new BadRequestException(
        `Đội nhóm không tồn tại: ${missing.join(', ')}. Chỉ Leader mới được tạo team mới.`,
      );
    }
  }

  /** Tạo nhân sự (MANAGER=ADMIN có full quyền, LEADER chỉ tạo MEMBER) */
  async createHR(callerId: string, callerRoles: UserRole[], dto: CreateUserDto) {
    const isManagerOrAdmin = callerRoles.includes(UserRole.ADMIN) || callerRoles.includes(UserRole.MANAGER);
    const isLeader = callerRoles.includes(UserRole.LEADER);
    let leaderTeamIds: string[] | null = null;

    if (!isManagerOrAdmin && isLeader) {
      const requestedRoles: UserRole[] = dto.roles?.length
        ? dto.roles
        : dto.role ? [dto.role] : [];

      if (requestedRoles.some(r => r !== UserRole.MEMBER)) {
        throw new ForbiddenException('Leader chỉ được tạo MEMBER');
      }
      // Force roles to exactly [MEMBER] — don't just validate "nothing else requested", since
      // an empty/omitted roles field would otherwise pass that check and create() would persist
      // roles: [], leaving the account without any role (locked out of every RolesGuard route).
      dto.roles = [UserRole.MEMBER];
      delete dto.role;
      // Gán member mới vào (các) Team mà leader đang thuộc/lãnh đạo — không tin payload client,
      // lấy thẳng từ TeamMember/Team.leader_id của caller (Team/TeamMember là nguồn sự thật;
      // team/team_leader_id trên User chỉ còn là giá trị phái sinh, tính lại sau khi tạo user).
      leaderTeamIds = await getUserTeamIds(this.prisma, callerId);
      delete dto.team;
      // A leader may only set name/email/password for a new hire — strip fields that grant
      // capability beyond that (manager_id ties them into an unrelated manager's hierarchy,
      // is_active should only go through deactivate/reactivate). The UI never sends these
      // for a LEADER, this only closes a direct-API gap.
      delete dto.manager_id;
      delete (dto as any).is_active;
    }

    // Validate tên team TRƯỚC khi tạo user: với role không phải LEADER, tên team lạ sẽ bị
    // assignUserToTeamsByName từ chối — nếu để lỗi đó nổ SAU this.create() thì đã lỡ tạo một
    // user mồ côi (có tài khoản nhưng request báo lỗi). create() không còn ghi dto.team nữa.
    const adminTeamNames = isManagerOrAdmin ? (dto.team ?? '').trim() : '';
    if (adminTeamNames) {
      await this.assertAssignableTeamNames(adminTeamNames, dto.roles ?? []);
    }

    const user = await this.create(dto);
    if (leaderTeamIds) {
      await assignUserToTeams(this.prisma, user.id, leaderTeamIds, callerId);
    } else if (adminTeamNames) {
      // ADMIN/MANAGER chọn/gõ (các) team qua multi-select khi tạo user mới — đi qua Team/TeamMember
      // thật sự (LEADER: tự tạo/nhận team; role khác: chỉ gán vào team đã có sẵn) thay vì chỉ ghi
      // chuỗi vào User.team. Không làm vậy thì editor-eligibility.ts sẽ không thấy họ thuộc team nào.
      await assignUserToTeamsByName(this.prisma, user.id, adminTeamNames, user.roles, callerId);
    }
    return user;
  }

  /** Cập nhật nhân sự (MANAGER=ADMIN full quyền, LEADER chỉ member team mình) */
  async updateHR(callerId: string, callerRoles: UserRole[], targetId: string, dto: UpdateUserDto) {
    const isManagerOrAdmin = callerRoles.includes(UserRole.ADMIN) || callerRoles.includes(UserRole.MANAGER);
    const isLeader = callerRoles.includes(UserRole.LEADER);
    let claimToCallerId: string | null = null;
    let releaseTarget = false;

    if (!isManagerOrAdmin && isLeader) {
      const target = await this.prisma.user.findUnique({ where: { id: targetId } });
      if (!target) throw new NotFoundException(`User ${targetId} not found`);

      // Thay cho target.team_leader_id === callerId — nguồn sự thật giờ là TeamMember/Team.leader_id.
      const isOwnMember = await isTeamLeaderOfUser(this.prisma, callerId, targetId);
      // "Unclaimed" must match getUnassignedMembers()'s definition (không có TeamMember nào), không
      // phải "chưa có team_leader_id cụ thể" — nếu không sẽ cho phép LEADER bất kỳ hijack một member
      // đã được MANAGER gán team nhưng chưa gán leader cụ thể.
      const isUnclaimed = await isUserUnassigned(this.prisma, targetId);

      if (!isOwnMember && !isUnclaimed) {
        throw new ForbiddenException('Leader chỉ được cập nhật member trong team mình');
      }
      if (dto.roles || (dto as any).role) {
        throw new ForbiddenException('Leader không được thay đổi role');
      }
      // A leader may only edit name/email/team(forced below) for a member they own — strip
      // fields that would let a direct API call bypass deactivate/reactivate's stricter
      // ownership check (is_active) or alter authorization-relevant data outside their scope
      // (manager_id). The UI never sends these for a LEADER.
      delete dto.manager_id;
      delete (dto as any).is_active;
      // team/team_leader_id giờ là giá trị phái sinh — không set trực tiếp qua dto, xử lý bằng
      // TeamMember sau khi update() xong (xem claimToCallerId/releaseTarget bên dưới). Chụp lại ý
      // định "release" (dto.team === null) trước khi xoá field.
      const wantsRelease = dto.team === null;
      delete dto.team;

      if (isUnclaimed) {
        // Claiming a not-yet-assigned member (e.g. a fresh Gmail signup) always attaches them to
        // this leader's own team(s) — force it server-side instead of trusting the client payload.
        claimToCallerId = callerId;
      } else if (wantsRelease) {
        // Already-claimed own member, leader explicitly releases them back to the shared
        // "unassigned" pool (e.g. member is moving teams and the new leader will claim them).
        releaseTarget = true;
      }
      // else: any other team change (i.e. picking a specific different team) is a manager-level
      // reassignment decision — dto.team/team_leader_id đã bị xoá ở trên, giữ nguyên giá trị cũ.
    }

    // dto.team !== undefined nghĩa là ADMIN/MANAGER thực sự đổi multi-select (kể cả xoá hết về
    // rỗng) — undefined nghĩa là field không được gửi lên, không đụng tới team hiện có.
    const shouldReplaceTeams = isManagerOrAdmin && dto.team !== undefined;
    const teamNamesForUpdate = dto.team;
    // team là field phái sinh — update() đã strip, xoá thêm ở đây cho rõ ý: giá trị thô từ
    // client không bao giờ được ghi thẳng, chỉ dùng làm input cho replaceUserTeamsByName.
    delete dto.team;
    if (shouldReplaceTeams && teamNamesForUpdate) {
      // Validate TRƯỚC this.update() — nếu để replaceUserTeamsByName ném lỗi sau đó thì các
      // field khác (tên/email/roles) đã ghi xong nhưng team thì không, user khó hiểu vì sao.
      const targetRoles = dto.roles?.length
        ? dto.roles
        : ((await this.prisma.user.findUnique({ where: { id: targetId }, select: { roles: true } }))?.roles ?? []);
      await this.assertAssignableTeamNames(teamNamesForUpdate, targetRoles);
    }
    // Chụp team phái sinh TRƯỚC khi đổi membership — để biết có cần sync các bảng lark không.
    const teamBefore =
      (await this.prisma.user.findUnique({ where: { id: targetId }, select: { team: true } }))?.team ?? null;

    const updated = await this.update(targetId, dto);
    const membershipChanged = !!claimToCallerId || releaseTarget || shouldReplaceTeams;
    if (claimToCallerId) {
      await assignUserToTeams(this.prisma, targetId, await getUserTeamIds(this.prisma, claimToCallerId), claimToCallerId);
    } else if (releaseTarget) {
      await clearUserTeams(this.prisma, targetId);
    } else if (shouldReplaceTeams) {
      // Cùng lý do như createHR(): ADMIN/MANAGER chọn/gõ (các) team qua multi-select khi sửa user —
      // phải đi qua Team/TeamMember thật sự, và coi danh sách mới là TOÀN BỘ sự thật (team nào bị
      // bỏ chọn thì user rời khỏi team đó).
      await replaceUserTeamsByName(this.prisma, targetId, teamNamesForUpdate, updated.roles, callerId);
    }

    if (!membershipChanged) return updated;

    // Sau khi membership đổi, users.team đã được recompute từ team_members (nguồn sự thật).
    // Sync giá trị PHÁI SINH đó (không phải chuỗi thô từ client) sang các bảng lark — giữ hành vi
    // cũ của update() (checklist/report_kpi/reported_tasks/kpi đổi theo team mới của người đó).
    const fresh = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { team: true, email: true, full_name: true },
    });
    if (fresh && (fresh.team ?? null) !== teamBefore) {
      await this.syncTeamAcrossLarkTables(fresh.email, fresh.full_name, fresh.team ?? null);
    }
    // Trả về bản mới nhất — updated ở trên chụp TRƯỚC khi recompute team nên field team đã cũ.
    return { ...updated, team: fresh?.team ?? null } as typeof updated;
  }

  /**
   * Đồng bộ team (giá trị phái sinh, ĐÃ recompute từ team_members) sang các bảng lark lịch sử —
   * thay cho nhánh teamChanged cũ trong update() vốn ghi chuỗi thô từ client.
   */
  private async syncTeamAcrossLarkTables(email: string | null, fullName: string | null, newTeam: string | null) {
    if (!email && !fullName) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.checklistReport.updateMany({
        where: email ? { email } : { name: fullName },
        data: { team: newTeam },
      });
      await tx.reportKpi.updateMany({
        where: email ? { email } : { name: fullName },
        data: { team: newTeam },
      });
      await tx.reportedTask.updateMany({
        where: email ? { employee_email: email } : { employee_name: fullName },
        data: { team: newTeam },
      });
      if (fullName) {
        await tx.kpi.updateMany({ where: { name: fullName }, data: { team: newTeam } });
      }
    }, TEAM_TX_OPTIONS);
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
      if (!(await isTeamLeaderOfUser(this.prisma, callerId, targetId))) {
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
    // Roster trang checklist cache theo prefix 'activity:' (TTL 5') — vô hiệu hóa phải ẩn ngay
    this.cacheService.invalidate('activity:');

    return { message: 'Tài khoản đã được vô hiệu hóa', user: updated };
  }

  /** Kích hoạt lại tài khoản */
  async reactivate(callerId: string, callerRoles: UserRole[], targetId: string) {
    const isManagerOrAdmin = callerRoles.includes(UserRole.ADMIN) || callerRoles.includes(UserRole.MANAGER);
    const isLeader = callerRoles.includes(UserRole.LEADER);

    const target = await this.prisma.user.findUnique({ where: { id: targetId } });
    if (!target) throw new NotFoundException(`User ${targetId} not found`);

    if (!isManagerOrAdmin && isLeader) {
      if (!(await isTeamLeaderOfUser(this.prisma, callerId, targetId))) {
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
    // Kích hoạt lại phải hiện lại ngay trên trang checklist
    this.cacheService.invalidate('activity:');

    return { message: 'Tài khoản đã được kích hoạt', user: updated };
  }

  /**
   * Xóa mềm vĩnh viễn: khác `deactivate` ở chỗ không có đường quay lại qua UI (không set is_active
   * lại về true được nữa) và tài khoản bị ẩn hoàn toàn khỏi mọi danh sách (getTeamMembers,
   * getUnassignedMembers...). Không hard-delete vì `users.id` bị hàng chục bảng tham chiếu KHÔNG
   * có onDelete Cascade/SetNull (Task.assignee, TaskAssignment, Notification...) — prisma.user.delete()
   * sẽ ném lỗi FK constraint với bất kỳ tài khoản nào đã từng có hoạt động thật.
   */
  async softDelete(callerId: string, callerRoles: UserRole[], targetId: string) {
    const isManagerOrAdmin = callerRoles.includes(UserRole.ADMIN) || callerRoles.includes(UserRole.MANAGER);
    const isLeader = callerRoles.includes(UserRole.LEADER);

    if (callerId === targetId) {
      throw new ForbiddenException('Không thể xóa tài khoản của chính mình');
    }

    const target = await this.prisma.user.findUnique({ where: { id: targetId } });
    if (!target || target.deleted_at) throw new NotFoundException(`User ${targetId} not found`);

    if (!isManagerOrAdmin && isLeader) {
      if (!(await isTeamLeaderOfUser(this.prisma, callerId, targetId))) {
        throw new ForbiddenException('Leader chỉ được xóa member trong team mình');
      }
    }

    // Thả khỏi mọi Team trước — resync team phái sinh cho các đồng đội còn lại, và tránh
    // tài khoản đã xóa trôi ngược vào "chưa phân team" (getUnassignedMembers dựa trên
    // "không còn TeamMember nào").
    await clearUserTeams(this.prisma, targetId);

    const updated = await this.prisma.user.update({
      where: { id: targetId },
      data: { is_active: false, deleted_at: new Date() },
      select: { id: true, email: true, full_name: true },
    });

    this.cacheService.invalidate(this.userCacheKey(targetId));
    this.cacheService.invalidate(this.userEmailCacheKey(target.email ?? ''));
    this.cacheService.invalidate(`jwt:user:${targetId}`);
    // Trang nhân sự xóa qua endpoint này — roster checklist (cache 'activity:') phải mất ngay
    this.cacheService.invalidate('activity:');

    return { message: 'Đã xóa tài khoản', user: updated };
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
        data: { image_url: uploaded.url },
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
