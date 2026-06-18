import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from "@nestjs/common";
import { CreateChannelDto } from "./dto/create-channel.dto";
import { UpdateChannelDto } from "./dto/update-channel.dto";
import { UserRole } from "@prisma/client";
import { PrismaService } from "@/common/prisma/prisma.service";

@Injectable()
export class ChannelsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private isLeader(roles: UserRole[]): boolean {
    return roles.includes(UserRole.LEADER);
  }

  /** Lấy channel và kiểm tra tồn tại */
  private async findChannelOrThrow(id: string) {
    const channel = await this.prisma.channel.findUnique({ where: { id } });
    if (!channel) throw new NotFoundException(`Channel ${id} not found`);
    return channel;
  }

  /** Kiểm tra LEADER có quyền thao tác trên channel này không */
  private assertLeaderOwnsChannel(
    channel: { team_traffic: string | null },
    userTeam: string | null | undefined,
  ) {
    if (!userTeam || channel.team_traffic !== userTeam) {
      throw new ForbiddenException(
        "You can only manage channels belonging to your team",
      );
    }
  }

  // ─── CRUD ───────────────────────────────────────────────────────────────────

  /**
   * Tạo kênh mới — chỉ LEADER.
   * team_traffic tự động = team của LEADER, không nhận từ client.
   */
  async create(
    dto: CreateChannelDto,
    user: { roles: UserRole[]; team: string | null },
  ) {
    if (!this.isLeader(user.roles)) {
      throw new ForbiddenException("Only LEADER can create channels");
    }

    return this.prisma.channel.create({
      data: {
        ...dto,
        team_traffic: user.team ?? null,
      },
    });
  }

  /**
   * Lấy danh sách kênh:
   * - LEADER + MEMBER: chỉ thấy kênh cùng team (`team_traffic = user.team`)
   * - Các role khác (ADMIN, MANAGER): cũng chỉ thấy kênh cùng team (theo spec)
   */
  async findAll(user: { roles: UserRole[]; team: string | null }) {
    return this.prisma.channel.findMany({
      where: { team_traffic: user.team ?? undefined },
      orderBy: { created_at: "desc" },
    });
  }

  /** Lấy 1 kênh — kiểm tra user chỉ xem kênh cùng team */
  async findOne(
    id: string,
    user: { roles: UserRole[]; team: string | null },
  ) {
    const channel = await this.findChannelOrThrow(id);

    if (channel.team_traffic !== user.team) {
      throw new ForbiddenException("You do not have access to this channel");
    }

    return channel;
  }

  /**
   * Cập nhật kênh — chỉ LEADER cùng team.
   * Không cho phép thay đổi team_traffic qua API.
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

    // Strip team_traffic nếu client cố tình truyền vào
    const { ...safeData } = dto;
    delete (safeData as any).team_traffic;

    return this.prisma.channel.update({
      where: { id },
      data: safeData,
    });
  }

  /**
   * Xóa kênh — chỉ LEADER cùng team.
   * Chặn nếu kênh đang được track bởi TrackedChannel.
   */
  async remove(
    id: string,
    user: { roles: UserRole[]; team: string | null },
  ) {
    if (!this.isLeader(user.roles)) {
      throw new ForbiddenException("Only LEADER can delete channels");
    }

    const channel = await this.findChannelOrThrow(id);
    this.assertLeaderOwnsChannel(channel, user.team);

    // Kiểm tra xem có TrackedChannel nào đang dùng kênh này không
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