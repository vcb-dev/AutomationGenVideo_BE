import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from "@nestjs/common";
import { randomUUID } from "crypto";
import { CreateChannelDto } from "./dto/create-channel.dto";
import { UpdateChannelDto } from "./dto/update-channel.dto";
import { UserRole } from "@prisma/client";
import { PrismaService } from "@/common/prisma/prisma.service";

const CHANNEL_INCLUDE = {
  channel_team: { select: { id: true, name: true } },
  channel_owner: { select: { id: true, full_name: true, email: true } },
} as const;

@Injectable()
export class ChannelsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private isLeader(roles: UserRole[]): boolean {
    return roles.includes(UserRole.LEADER);
  }

  /** Resolve team_id từ tên team (User.team là string) */
  private async resolveTeamId(
    teamName: string | null | undefined,
  ): Promise<string | null> {
    if (!teamName) return null;
    const team = await this.prisma.team.findFirst({
      where: { name: { equals: teamName, mode: "insensitive" } },
      select: { id: true },
    });
    return team?.id ?? null;
  }

  /** Lấy channel và kiểm tra tồn tại, kèm relations */
  private async findChannelOrThrow(id: string) {
    const channel = await this.prisma.channel.findUnique({
      where: { id },
      include: CHANNEL_INCLUDE,
    });
    if (!channel) throw new NotFoundException(`Channel ${id} not found`);
    return channel;
  }

  /** Kiểm tra LEADER có quyền thao tác trên channel này không */
  private assertLeaderOwnsChannel(
    channel: { channel_team: { name: string } | null },
    userTeam: string | null | undefined,
  ) {
    if (!userTeam || channel.channel_team?.name !== userTeam) {
      throw new ForbiddenException(
        "You can only manage channels belonging to your team",
      );
    }
  }

  // ─── CRUD ───────────────────────────────────────────────────────────────────

  /**
   * Tạo kênh mới — mọi role đều được, tự động gán owner_id và team_id từ user.
   *
   * Đồng thời ghi thêm `owner`/`team_traffic` (field string cũ, tiền thân từ thời đồng bộ Lark) —
   * đây là field mà logic tính "cần báo cáo traffic" (`needsTraffic` trong lark.service.ts) đang đọc.
   * Chỉ ghi owner_id/team_id (FK) mà bỏ 2 field này khiến kênh tạo qua đây bị "vô hình" với báo cáo traffic.
   */
  async create(
    dto: CreateChannelDto,
    user: { id: string; roles: UserRole[]; team: string | null; full_name?: string | null },
  ) {
    const team_id = await this.resolveTeamId(user.team);

    return this.prisma.channel.create({
      data: {
        id: `manual_${randomUUID()}`,
        ...dto,
        owner_id: user.id,
        team_id: team_id ?? undefined,
        owner: user.full_name || undefined,
        team_traffic: user.team || undefined,
      },
      include: CHANNEL_INCLUDE,
    });
  }

  /** Lấy tất cả kênh thuộc về user hiện tại (owner_id). */
  async findMine(userId: string) {
    return this.prisma.channel.findMany({
      where: { owner_id: userId },
      include: CHANNEL_INCLUDE,
      orderBy: { created_at: "desc" },
    });
  }

  /**
   * Lấy danh sách kênh thuộc team của user hiện tại.
   */
  async findAll(user: { roles: UserRole[]; team: string | null }) {
    return this.prisma.channel.findMany({
      where: user.team
        ? { channel_team: { name: { equals: user.team, mode: "insensitive" } } }
        : undefined,
      include: CHANNEL_INCLUDE,
      orderBy: { created_at: "desc" },
    });
  }

  /** Lấy 1 kênh — kiểm tra user chỉ xem kênh cùng team */
  async findOne(id: string, user: { roles: UserRole[]; team: string | null }) {
    const channel = await this.findChannelOrThrow(id);

    if (channel.channel_team?.name !== user.team) {
      throw new ForbiddenException("You do not have access to this channel");
    }

    return channel;
  }

  /** Kiểm tra owner_id mới (nếu có) phải thuộc cùng team với kênh, hoặc là chính leader */
  private async assertOwnerInTeam(
    ownerId: string,
    teamId: string | null,
    callerId: string,
  ) {
    if (ownerId === callerId) return;

    if (!teamId) {
      throw new ForbiddenException(
        "Channel chưa thuộc team nào, không thể gán owner",
      );
    }

    const membership = await this.prisma.teamMember.findFirst({
      where: { team_id: teamId, user_id: ownerId },
      select: { id: true },
    });
    if (!membership) {
      throw new ForbiddenException(
        "Owner phải là thành viên trong team của kênh",
      );
    }
  }

  /**
   * Cập nhật kênh — chỉ LEADER cùng team.
   * Không cho phép thay đổi team_id qua API.
   * owner_id (nếu truyền) phải thuộc cùng team với kênh hoặc là chính leader.
   */
  async update(
    id: string,
    dto: UpdateChannelDto,
    user: { id: string; roles: UserRole[]; team: string | null },
  ) {
    if (!this.isLeader(user.roles)) {
      throw new ForbiddenException("Only LEADER can update channels");
    }

    const channel = await this.findChannelOrThrow(id);
    this.assertLeaderOwnsChannel(channel, user.team);

    // Strip team_id nếu client cố tình truyền vào
    const { ...safeData } = dto;
    delete (safeData as any).team_id;

    if (dto.owner_id) {
      await this.assertOwnerInTeam(dto.owner_id, channel.team_id, user.id);
      // Đồng bộ field `owner` (string cũ) theo owner_id mới — logic tính "cần báo cáo traffic"
      // (needsTraffic trong lark.service.ts) đọc field này, không đọc owner_id.
      const newOwner = await this.prisma.user.findUnique({
        where: { id: dto.owner_id },
        select: { full_name: true },
      });
      (safeData as any).owner = newOwner?.full_name || undefined;
      // Channel không đổi team qua update() — team_traffic luôn khớp team của leader gọi API
      // (đã assertLeaderOwnsChannel ở trên đảm bảo channel.channel_team.name === user.team).
      (safeData as any).team_traffic = user.team || undefined;
    }

    return this.prisma.channel.update({
      where: { id },
      data: safeData,
      include: CHANNEL_INCLUDE,
    });
  }

  /**
   * Xóa kênh — chỉ LEADER cùng team.
   * Chặn nếu kênh đang được track bởi TrackedChannel.
   */
  /**
   * Tra cứu team + owner theo danh sách URL kênh hoặc channel_id nền tảng.
   * FE gửi lên mảng identifiers (URL hoặc platform ID), BE trả về map.
   */
  async lookupByIdentifiers(
    identifiers: string[],
  ): Promise<Record<string, { team_name: string | null; owner_name: string | null }>> {
    if (!identifiers.length) return {};
    const unique = [...new Set(identifiers.filter(Boolean))];
    const where = {
      OR: [
        { link_channel: { in: unique } },
        { channel_id: { in: unique } },
      ],
    };
    const ownerSelect = { select: { full_name: true } } as const;

    // Thử JOIN teams trước; nếu bảng teams chưa tồn tại trong DB thì fallback không JOIN
    type Row = {
      link_channel: string | null;
      channel_id: string | null;
      owner: string | null;
      channel_owner: { full_name: string } | null;
      channel_team?: { name: string } | null;
    };
    let rows: Row[];
    try {
      rows = (await this.prisma.channel.findMany({
        where,
        select: {
          link_channel: true,
          channel_id: true,
          owner: true,
          channel_owner: ownerSelect,
          channel_team: { select: { name: true } },
        },
      })) as Row[];
    } catch {
      rows = (await this.prisma.channel.findMany({
        where,
        select: {
          link_channel: true,
          channel_id: true,
          owner: true,
          channel_owner: ownerSelect,
        },
      })) as Row[];
    }

    const result: Record<string, { team_name: string | null; owner_name: string | null }> = {};
    for (const c of rows) {
      const info = {
        team_name: c.channel_team?.name ?? null,
        owner_name: c.channel_owner?.full_name ?? c.owner ?? null,
      };
      if (c.link_channel && unique.includes(c.link_channel)) result[c.link_channel] = info;
      if (c.channel_id && unique.includes(c.channel_id)) result[c.channel_id] = info;
    }
    return result;
  }

  async remove(id: string, user: { roles: UserRole[]; team: string | null }) {
    if (!this.isLeader(user.roles)) {
      throw new ForbiddenException("Only LEADER can delete channels");
    }

    const channel = await this.findChannelOrThrow(id);
    this.assertLeaderOwnsChannel(channel, user.team);

    const trackedCount = await this.prisma.trackedChannel.count({
      where: { lark_channel_id: id },
    });

    if (trackedCount > 0) {
      throw new ConflictException(
        "Cannot delete this channel because it is currently being tracked. Please remove the tracked channel first.",
      );
    }

    await this.prisma.channel.delete({ where: { id } });

    return { message: "Channel deleted successfully" };
  }
}
