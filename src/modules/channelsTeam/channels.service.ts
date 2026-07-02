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
   */
  async create(
    dto: CreateChannelDto,
    user: { id: string; roles: UserRole[]; team: string | null },
  ) {
    const team_id = await this.resolveTeamId(user.team);

    return this.prisma.channel.create({
      data: {
        id: `manual_${randomUUID()}`,
        ...dto,
        owner_id: user.id,
        team_id: team_id ?? undefined,
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

  /**
   * Cập nhật kênh — chỉ LEADER cùng team.
   * Không cho phép thay đổi team_id qua API.
   */
  async update(
    id: string,
    dto: UpdateChannelDto,
    user: { roles: UserRole[]; team: string | null },
  ) {
    if (!this.isLeader(user.roles)) {
      throw new ForbiddenException("Only LEADER can update channels");
    }

    const channel = await this.findChannelOrThrow(id);
    this.assertLeaderOwnsChannel(channel, user.team);

    // Strip team_id nếu client cố tình truyền vào
    const { ...safeData } = dto;
    delete (safeData as any).team_id;

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
