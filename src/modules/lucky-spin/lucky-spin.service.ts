import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomInt } from 'crypto';
import { Prisma, SpinEntryStatus, SpinRoundKind } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  CONTROL_TTL_MS,
  HISTORY_POLL_LIMIT,
  MAX_DRAW_COUNT,
  NO_TEAM_LABEL,
  SPIN_DURATION_MS,
  SPIN_WORKSPACES,
  laTenKhongDuocTrung,
} from './lucky-spin.constants';
import {
  AwardGiftDto,
  ConfirmRoundDto,
  DrawRoundDto,
  BulkCreateGiftsDto,
  BulkCreateMembersDto,
  CreateGiftDto,
  CreateMemberDto,
  CreateTeamDto,
  RecordMemberWinDto,
  RecordTeamWinDto,
  ResetStatusesDto,
  UpdateGiftDto,
  UpdateMemberDto,
  UpdateTeamDto,
} from './dto';

/** User đang thao tác — dùng để ghi vào lịch sử ai đã bấm xác nhận. */
export interface SpinActor {
  id?: string;
  name?: string;
}

@Injectable()
export class LuckySpinService {
  constructor(private readonly prisma: PrismaService) {}

  /* ─────────────────────────── Workspace ─────────────────────────── */

  /**
   * Lấy id vòng quay theo slug, tự tạo nếu chưa có.
   *
   * Nhờ vậy môi trường mới không cần chạy seed, và không có đường nào tạo ra vòng quay lạ
   * ngoài danh sách đã khai báo trong code.
   */
  private async resolveWorkspaceId(slug: string): Promise<string> {
    const known = SPIN_WORKSPACES.find((w) => w.slug === slug);
    if (!known) throw new NotFoundException(`Không có vòng quay "${slug}"`);

    const ws = await this.prisma.spinWorkspace.upsert({
      where: { slug: known.slug },
      update: {},
      create: { slug: known.slug, name: known.name, order_index: known.orderIndex },
      select: { id: true },
    });
    return ws.id;
  }

  async listWorkspaces() {
    return SPIN_WORKSPACES.map((w) => ({ id: w.slug, name: w.name }));
  }


  /* ────────────────────── Khóa điều khiển ────────────────────────── */

  /**
   * Ai đang giữ quyền điều khiển, tính cả việc khóa đã hết hạn hay chưa.
   *
   * Khóa hết hạn được coi như không có người giữ — không cần job dọn nền, chỉ cần so mốc
   * thời gian mỗi lần đọc.
   */
  private controlStateOf(ws: {
    controller_id: string | null;
    controller_name: string | null;
    control_expires_at: Date | null;
  }) {
    const alive = !!ws.control_expires_at && ws.control_expires_at.getTime() > Date.now();
    return {
      controllerId: alive ? ws.controller_id : null,
      controllerName: alive ? ws.controller_name : null,
      expiresAt: alive ? ws.control_expires_at!.toISOString() : null,
    };
  }

  /**
   * Cấp quyền điều khiển cho actor.
   *
   * `force` dùng cho nút "Tiếp quản": MC trước có thể đã đóng máy mà khóa chưa kịp hết hạn,
   * chờ hết 3 phút giữa buổi sự kiện là quá lâu.
   */
  async claimControl(slug: string, actor: SpinActor, force = false) {
    const workspaceId = await this.resolveWorkspaceId(slug);
    const ws = await this.prisma.spinWorkspace.findUniqueOrThrow({ where: { id: workspaceId } });
    const current = this.controlStateOf(ws);

    if (!force && current.controllerId && current.controllerId !== actor.id) {
      throw new ConflictException(`${current.controllerName ?? 'Người khác'} đang điều khiển vòng quay này.`);
    }

    const updated = await this.prisma.spinWorkspace.update({
      where: { id: workspaceId },
      data: {
        controller_id: actor.id ?? null,
        controller_name: actor.name ?? null,
        control_expires_at: new Date(Date.now() + CONTROL_TTL_MS),
      },
    });
    return this.controlStateOf(updated);
  }

  /** Nhả quyền để người khác dùng ngay, không phải chờ hết hạn. */
  async releaseControl(slug: string, actor: SpinActor) {
    const workspaceId = await this.resolveWorkspaceId(slug);
    const ws = await this.prisma.spinWorkspace.findUniqueOrThrow({ where: { id: workspaceId } });
    const current = this.controlStateOf(ws);

    if (current.controllerId && current.controllerId !== actor.id) {
      throw new ConflictException('Bạn không phải người đang điều khiển.');
    }
    const updated = await this.prisma.spinWorkspace.update({
      where: { id: workspaceId },
      data: { controller_id: null, controller_name: null, control_expires_at: null },
    });
    return this.controlStateOf(updated);
  }

  /**
   * Cổng chung cho MỌI thao tác ghi.
   *
   * Không ai giữ khóa thì người ghi đầu tiên tự nhận khóa — dùng một mình không phải bấm thêm
   * nút nào. Có người khác đang giữ thì chặn kèm tên họ, để người bấm biết vì sao bị từ chối
   * thay vì tưởng hệ thống lỗi.
   */
  private async assertControl(slug: string, actor: SpinActor) {
    const workspaceId = await this.resolveWorkspaceId(slug);
    const ws = await this.prisma.spinWorkspace.findUniqueOrThrow({ where: { id: workspaceId } });
    const current = this.controlStateOf(ws);

    if (current.controllerId && current.controllerId !== actor.id) {
      throw new ConflictException(
        `${current.controllerName ?? 'Người khác'} đang điều khiển vòng quay này. Bạn chỉ có thể xem.`,
      );
    }

    // Vừa cấp vừa gia hạn khóa: mỗi thao tác là một nhịp heartbeat.
    await this.prisma.spinWorkspace.update({
      where: { id: workspaceId },
      data: {
        controller_id: actor.id ?? null,
        controller_name: actor.name ?? null,
        control_expires_at: new Date(Date.now() + CONTROL_TTL_MS),
      },
    });
    return workspaceId;
  }

  /* ───────────────────────────── State ───────────────────────────── */

  /**
   * Toàn bộ dữ liệu của một vòng quay trong đúng một request.
   *
   * FE poll hàm này vài giây một lần nên mọi thứ phải nằm trong một lần gọi; tách nhỏ thành
   * nhiều endpoint sẽ khiến các phần dữ liệu lệch nhau giữa hai lần poll.
   */
  async getState(slug: string) {
    const workspaceId = await this.resolveWorkspaceId(slug);
    const ws = await this.prisma.spinWorkspace.findUniqueOrThrow({ where: { id: workspaceId } });

    const [teams, members, gifts, memberWins, teamWins, giftAwards, counts, activeRound] = await Promise.all([
      this.prisma.spinTeam.findMany({ where: { workspace_id: workspaceId }, orderBy: { created_at: 'asc' } }),
      this.prisma.spinMember.findMany({ where: { workspace_id: workspaceId }, orderBy: { created_at: 'asc' } }),
      this.prisma.spinGift.findMany({ where: { workspace_id: workspaceId }, orderBy: { created_at: 'asc' } }),
      this.prisma.spinMemberWin.findMany({
        where: { workspace_id: workspaceId },
        orderBy: { created_at: 'desc' },
        take: HISTORY_POLL_LIMIT,
      }),
      this.prisma.spinTeamWin.findMany({
        where: { workspace_id: workspaceId },
        orderBy: { created_at: 'desc' },
        take: HISTORY_POLL_LIMIT,
      }),
      this.prisma.spinGiftAward.findMany({
        where: { workspace_id: workspaceId },
        orderBy: { created_at: 'desc' },
        take: HISTORY_POLL_LIMIT,
      }),
      this.historyCounts(workspaceId),
      this.activeRoundOf(workspaceId),
    ]);

    return {
      control: this.controlStateOf(ws),
      historyCounts: counts,
      historyLimit: HISTORY_POLL_LIMIT,
      activeRound,
      teams: teams.map((t) => ({
        id: t.id,
        name: t.name,
        status: t.status === SpinEntryStatus.DONE ? 'done' : 'active',
        giftReceived: t.gift_received,
      })),
      members: members.map((m) => ({
        id: m.id,
        name: m.name,
        teamId: m.team_id ?? '',
        status: m.status === SpinEntryStatus.DONE ? 'done' : 'active',
        giftReceived: m.gift_received,
      })),
      gifts: gifts.map((g) => ({ id: g.id, name: g.name, total: g.total, remaining: g.remaining })),
      history: memberWins.map((h) => ({
        id: h.id,
        memberId: h.member_id ?? '',
        name: h.member_name,
        team: h.team_name,
        time: h.created_at.toISOString(),
        by: h.created_by_name ?? undefined,
      })),
      teamHistory: teamWins.map((h) => ({
        id: h.id,
        teamId: h.team_id ?? '',
        name: h.team_name,
        time: h.created_at.toISOString(),
        by: h.created_by_name ?? undefined,
      })),
      giftHistory: giftAwards.map((h) => ({
        id: h.id,
        memberId: h.member_id ?? undefined,
        teamId: h.team_id ?? undefined,
        name: h.recipient_name,
        team: h.team_name,
        gift: h.gift_name,
        time: h.created_at.toISOString(),
        by: h.created_by_name ?? undefined,
      })),
    };
  }

  private async historyCounts(workspaceId: string) {
    const [members, teams, gifts] = await Promise.all([
      this.prisma.spinMemberWin.count({ where: { workspace_id: workspaceId } }),
      this.prisma.spinTeamWin.count({ where: { workspace_id: workspaceId } }),
      this.prisma.spinGiftAward.count({ where: { workspace_id: workspaceId } }),
    ]);
    return { members, teams, gifts };
  }

  /**
   * Toàn bộ lịch sử một loại, không giới hạn — chỉ dùng lúc xuất Excel/PDF.
   *
   * Tách khỏi getState để đường poll 5 giây không phải gánh dữ liệu mà màn hình không hiển thị.
   */
  async listFullHistory(slug: string, kind: 'members' | 'teams' | 'gifts') {
    const workspaceId = await this.resolveWorkspaceId(slug);
    const where = { workspace_id: workspaceId };
    const orderBy = { created_at: 'desc' as const };

    if (kind === 'members') {
      const rows = await this.prisma.spinMemberWin.findMany({ where, orderBy });
      return rows.map((h) => ({
        id: h.id,
        memberId: h.member_id ?? '',
        name: h.member_name,
        team: h.team_name,
        time: h.created_at.toISOString(),
        by: h.created_by_name ?? undefined,
      }));
    }
    if (kind === 'teams') {
      const rows = await this.prisma.spinTeamWin.findMany({ where, orderBy });
      return rows.map((h) => ({
        id: h.id,
        teamId: h.team_id ?? '',
        name: h.team_name,
        time: h.created_at.toISOString(),
        by: h.created_by_name ?? undefined,
      }));
    }
    const rows = await this.prisma.spinGiftAward.findMany({ where, orderBy });
    return rows.map((h) => ({
      id: h.id,
      memberId: h.member_id ?? undefined,
      teamId: h.team_id ?? undefined,
      name: h.recipient_name,
      team: h.team_name,
      gift: h.gift_name,
      time: h.created_at.toISOString(),
      by: h.created_by_name ?? undefined,
    }));
  }


  /* ────────────────────────── Lượt quay ──────────────────────────── */

  /**
   * Bốc kết quả ở server.
   *
   * Trước đây trình duyệt tự bốc rồi báo lên, nghĩa là ai mở DevTools cũng ép được người trúng.
   * Giờ server chốt cả thứ tự ô trên bánh xe lẫn ô thắng, dùng `randomInt` của crypto thay cho
   * `Math.random`. FE chỉ còn việc quay bánh xe tới đúng ô đã định.
   */
  async drawRound(slug: string, dto: DrawRoundDto, actor: SpinActor) {
    const workspaceId = await this.assertControl(slug, actor);
    const count = Math.min(dto.count ?? 1, MAX_DRAW_COUNT);

    let pool: { id: string; name: string }[];
    let kind: SpinRoundKind;

    if (dto.kind === 'team') {
      kind = SpinRoundKind.TEAM;
      const teams = await this.prisma.spinTeam.findMany({
        where: { workspace_id: workspaceId, status: SpinEntryStatus.ACTIVE },
        orderBy: { created_at: 'asc' },
      });
      pool = teams.map((t) => ({ id: t.id, name: t.name }));
    } else if (dto.kind === 'member') {
      kind = SpinRoundKind.MEMBER;
      const members = await this.prisma.spinMember.findMany({
        where: {
          workspace_id: workspaceId,
          status: SpinEntryStatus.ACTIVE,
          ...(dto.scopeTeamId ? { team_id: dto.scopeTeamId } : {}),
        },
        orderBy: { created_at: 'asc' },
      });
      pool = members.map((m) => ({ id: m.id, name: m.name }));
    } else {
      kind = SpinRoundKind.GIFT;
      const gifts = await this.prisma.spinGift.findMany({
        where: { workspace_id: workspaceId, remaining: { gt: 0 } },
        orderBy: { created_at: 'asc' },
      });
      pool = gifts.map((g) => ({ id: g.id, name: g.name }));
    }

    if (pool.length === 0) throw new BadRequestException('Không còn gì trong vòng quay để bốc.');
    if (kind !== SpinRoundKind.GIFT && pool.length < 2) {
      throw new BadRequestException('Cần ít nhất 2 mục để quay.');
    }
    if (count > pool.length) {
      throw new BadRequestException(`Chỉ còn ${pool.length} mục, không bốc được ${count}.`);
    }

    const soLuongBoc = kind === SpinRoundKind.GIFT ? 1 : count;

    /*
     * Vòng quay cá nhân: loại người trong danh sách chặn ra khỏi tập ô CÓ THỂ THẮNG, không phải
     * ra khỏi `pool`. Bánh xe vẫn hiện đủ tên như file nhân sự đã nhập, chỉ ô thắng là không bao
     * giờ rơi vào họ. Lọc ở đây chứ không lọc trong câu findMany vì `pool` còn được dùng để dựng
     * bánh xe cho mọi màn hình đang xem.
     *
     * Vòng quay team không lọc: pool là tên team, không phải tên người.
     */
    const oCoTheThang = pool
      .map((_, i) => i)
      .filter((i) => kind !== SpinRoundKind.MEMBER || !laTenKhongDuocTrung(pool[i].name));

    // Không đủ người hợp lệ thì báo lỗi chứ không hạ chuẩn: để lọt một lượt là hỏng cả yêu cầu.
    if (oCoTheThang.length < soLuongBoc) {
      throw new BadRequestException(`Chỉ còn ${oCoTheThang.length} mục hợp lệ, không bốc được ${soLuongBoc}.`);
    }

    const winnerIndexes = this.pickDistinctIndexes(oCoTheThang, soLuongBoc);

    const round = await this.prisma.spinRound.create({
      data: {
        workspace_id: workspaceId,
        kind,
        pool_ids: pool.map((p) => p.id),
        pool_names: pool.map((p) => p.name),
        winner_indexes: winnerIndexes,
        recipient_id: dto.recipientId ?? null,
        recipient_type: dto.recipientType ?? null,
        created_by_id: actor.id,
        created_by_name: actor.name,
      },
    });

    return this.roundView(round);
  }

  /**
   * Fisher-Yates một phần bằng crypto — không lặp người, không lệch phân phối.
   *
   * Nhận sẵn danh sách ô được phép thắng thay vì kích thước bánh xe, vì hai con số này không
   * còn bằng nhau từ khi có danh sách chặn: người bị chặn vẫn chiếm một ô trên bánh xe.
   */
  private pickDistinctIndexes(oCoTheThang: number[], count: number): number[] {
    const idx = [...oCoTheThang];
    for (let i = 0; i < count; i++) {
      const j = i + randomInt(idx.length - i);
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    return idx.slice(0, count);
  }

  private roundView(round: {
    id: string;
    kind: SpinRoundKind;
    pool_ids: string[];
    pool_names: string[];
    winner_indexes: number[];
    recipient_id: string | null;
    recipient_type: string | null;
    started_at: Date;
  }) {
    return {
      id: round.id,
      kind: round.kind === SpinRoundKind.TEAM ? 'team' : round.kind === SpinRoundKind.GIFT ? 'gift' : 'member',
      pool: round.pool_ids.map((id, i) => ({ id, name: round.pool_names[i] ?? '' })),
      winnerIndexes: round.winner_indexes,
      recipientId: round.recipient_id ?? undefined,
      recipientType: round.recipient_type ?? undefined,
      startedAt: round.started_at.toISOString(),
      durationMs: SPIN_DURATION_MS,
    };
  }

  /**
   * Lượt quay đang chạy hoặc vừa xong, để màn hình người xem dựng lại đúng vòng quay đó.
   * Chỉ lấy trong khoảng thời gian animation cộng một khoảng đệm ngắn.
   */
  private async activeRoundOf(workspaceId: string) {
    const round = await this.prisma.spinRound.findFirst({
      where: {
        workspace_id: workspaceId,
        settled_at: null,
        started_at: { gt: new Date(Date.now() - SPIN_DURATION_MS - 20_000) },
      },
      orderBy: { started_at: 'desc' },
    });
    return round ? this.roundView(round) : null;
  }

  /** Xác nhận cả lượt: ghi hết người trúng trong một transaction rồi đóng lượt. */
  async confirmRound(slug: string, roundId: string, dto: ConfirmRoundDto, actor: SpinActor) {
    const workspaceId = await this.assertControl(slug, actor);
    const round = await this.prisma.spinRound.findFirst({ where: { id: roundId, workspace_id: workspaceId } });
    if (!round) throw new NotFoundException('Lượt quay không còn tồn tại');
    if (round.settled_at) throw new ConflictException('Lượt quay này đã được xử lý rồi.');

    const winnerIds = round.winner_indexes.map((i) => round.pool_ids[i]).filter(Boolean);

    if (round.kind === SpinRoundKind.GIFT) {
      const giftId = winnerIds[0];
      if (!giftId || !round.recipient_id || !round.recipient_type) {
        throw new BadRequestException('Lượt quay quà thiếu thông tin người nhận.');
      }
      const award = await this.awardGift(
        slug,
        {
          giftId,
          recipientType: round.recipient_type as 'member' | 'team',
          recipientId: round.recipient_id,
        },
        actor,
      );
      await this.prisma.spinRound.update({ where: { id: round.id }, data: { settled_at: new Date() } });
      return { entries: [award] };
    }

    const entries: unknown[] = [];
    for (const id of winnerIds) {
      entries.push(
        round.kind === SpinRoundKind.TEAM
          ? await this.recordTeamWin(slug, { teamId: id, removeFromPool: dto.removeFromPool }, actor)
          : await this.recordMemberWin(slug, { memberId: id, removeFromPool: dto.removeFromPool }, actor),
      );
    }
    await this.prisma.spinRound.update({ where: { id: round.id }, data: { settled_at: new Date() } });
    return { entries };
  }

  /** Hủy lượt quay chưa xác nhận — không ghi gì vào lịch sử. */
  async cancelRound(slug: string, roundId: string, actor: SpinActor) {
    const workspaceId = await this.assertControl(slug, actor);
    const updated = await this.prisma.spinRound.updateMany({
      where: { id: roundId, workspace_id: workspaceId, settled_at: null },
      data: { settled_at: new Date() },
    });
    if (updated.count === 0) throw new NotFoundException('Lượt quay không còn tồn tại');
    return { cancelled: true };
  }

  /* ───────────────────────────── Teams ───────────────────────────── */

  async createTeam(slug: string, dto: CreateTeamDto, actor: SpinActor) {
    const workspaceId = await this.assertControl(slug, actor);
    return this.prisma.spinTeam.create({ data: { workspace_id: workspaceId, name: dto.name.trim() } });
  }

  async updateTeam(slug: string, teamId: string, dto: UpdateTeamDto, actor: SpinActor) {
    await this.assertControl(slug, actor);
    await this.assertTeamInWorkspace(slug, teamId);
    return this.prisma.spinTeam.update({
      where: { id: teamId },
      data: { ...(dto.name !== undefined && { name: dto.name.trim() }) },
    });
  }

  async deleteTeam(slug: string, teamId: string, actor: SpinActor) {
    await this.assertControl(slug, actor);
    await this.assertTeamInWorkspace(slug, teamId);
    const memberCount = await this.prisma.spinMember.count({ where: { team_id: teamId } });
    if (memberCount > 0) {
      throw new BadRequestException('Không thể xóa team còn thành viên. Hãy xóa hoặc chuyển thành viên trước.');
    }
    await this.prisma.spinTeam.delete({ where: { id: teamId } });
    return { deleted: true };
  }

  /* ──────────────────────────── Members ──────────────────────────── */

  async createMember(slug: string, dto: CreateMemberDto, actor: SpinActor) {
    const workspaceId = await this.assertControl(slug, actor);
    await this.assertTeamInWorkspace(slug, dto.teamId);
    return this.prisma.spinMember.create({
      data: { workspace_id: workspaceId, team_id: dto.teamId, name: dto.name.trim() },
    });
  }

  /**
   * Nhập hàng loạt từ file Excel.
   *
   * Chạy trong một transaction: file 500 dòng mà hỏng ở dòng 300 thì không được để lại 299
   * thành viên nửa vời cho người dùng phải tự dọn.
   */
  async bulkCreateMembers(slug: string, dto: BulkCreateMembersDto, actor: SpinActor) {
    const workspaceId = await this.assertControl(slug, actor);

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.spinTeam.findMany({ where: { workspace_id: workspaceId } });
      const teamIdByLowerName = new Map(existing.map((t) => [t.name.toLowerCase(), t.id]));

      let createdTeams = 0;
      const membersData: Prisma.SpinMemberCreateManyInput[] = [];

      for (const row of dto.members) {
        const name = row.name.trim();
        const teamName = row.teamName.trim();
        if (!name || !teamName) continue;

        let teamId = teamIdByLowerName.get(teamName.toLowerCase());
        if (!teamId) {
          const created = await tx.spinTeam.create({
            data: { workspace_id: workspaceId, name: teamName },
            select: { id: true },
          });
          teamId = created.id;
          teamIdByLowerName.set(teamName.toLowerCase(), teamId);
          createdTeams++;
        }
        membersData.push({ workspace_id: workspaceId, team_id: teamId, name });
      }

      if (membersData.length > 0) await tx.spinMember.createMany({ data: membersData });
      return { createdMembers: membersData.length, createdTeams };
    });
  }

  async updateMember(slug: string, memberId: string, dto: UpdateMemberDto, actor: SpinActor) {
    await this.assertControl(slug, actor);
    await this.assertMemberInWorkspace(slug, memberId);
    if (dto.teamId) await this.assertTeamInWorkspace(slug, dto.teamId);
    return this.prisma.spinMember.update({
      where: { id: memberId },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.teamId !== undefined && { team_id: dto.teamId }),
      },
    });
  }

  async deleteMember(slug: string, memberId: string, actor: SpinActor) {
    await this.assertControl(slug, actor);
    await this.assertMemberInWorkspace(slug, memberId);
    // Lịch sử giữ lại: member_id chuyển thành null nhờ onDelete SetNull, tên đã được chụp sẵn.
    await this.prisma.spinMember.delete({ where: { id: memberId } });
    return { deleted: true };
  }

  /* ───────────────────────────── Gifts ───────────────────────────── */

  async createGift(slug: string, dto: CreateGiftDto, actor: SpinActor) {
    const workspaceId = await this.assertControl(slug, actor);
    return this.prisma.spinGift.create({
      data: { workspace_id: workspaceId, name: dto.name.trim(), total: dto.total, remaining: dto.total },
    });
  }

  async bulkCreateGifts(slug: string, dto: BulkCreateGiftsDto, actor: SpinActor) {
    const workspaceId = await this.assertControl(slug, actor);
    const data = dto.gifts
      .filter((g) => g.name.trim() && g.total > 0)
      .map((g) => ({ workspace_id: workspaceId, name: g.name.trim(), total: g.total, remaining: g.total }));

    if (data.length > 0) await this.prisma.spinGift.createMany({ data });
    return { createdGifts: data.length };
  }

  async updateGift(slug: string, giftId: string, dto: UpdateGiftDto, actor: SpinActor) {
    await this.assertControl(slug, actor);
    const gift = await this.assertGiftInWorkspace(slug, giftId);
    const total = dto.total ?? gift.total;
    // Còn lại không bao giờ vượt tổng, kể cả khi người dùng sửa tổng xuống thấp hơn.
    const remaining = Math.min(dto.remaining ?? gift.remaining, total);

    return this.prisma.spinGift.update({
      where: { id: giftId },
      data: { ...(dto.name !== undefined && { name: dto.name.trim() }), total, remaining },
    });
  }

  async deleteGift(slug: string, giftId: string, actor: SpinActor) {
    await this.assertControl(slug, actor);
    await this.assertGiftInWorkspace(slug, giftId);
    await this.prisma.spinGift.delete({ where: { id: giftId } });
    return { deleted: true };
  }

  /* ─────────────────────── Ghi kết quả quay ──────────────────────── */

  async recordMemberWin(slug: string, dto: RecordMemberWinDto, actor: SpinActor) {
    const workspaceId = await this.assertControl(slug, actor);
    const member = await this.prisma.spinMember.findFirst({
      where: { id: dto.memberId, workspace_id: workspaceId },
      include: { team: true },
    });
    if (!member) throw new NotFoundException('Thành viên không còn trong danh sách');
    // Màn hình có thể đang xem dữ liệu cũ vài giây: chặn ở đây để một người không trúng hai lần.
    if (member.status === SpinEntryStatus.DONE) {
      throw new ConflictException(`${member.name} đã trúng ở lượt trước, hãy tải lại trang.`);
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.removeFromPool) {
        await tx.spinMember.update({ where: { id: member.id }, data: { status: SpinEntryStatus.DONE } });
      }
      return tx.spinMemberWin.create({
        data: {
          workspace_id: workspaceId,
          member_id: member.id,
          member_name: member.name,
          team_name: member.team?.name ?? NO_TEAM_LABEL,
          created_by_id: actor.id,
          created_by_name: actor.name,
        },
      });
    });
  }

  async recordTeamWin(slug: string, dto: RecordTeamWinDto, actor: SpinActor) {
    const workspaceId = await this.assertControl(slug, actor);
    const team = await this.prisma.spinTeam.findFirst({ where: { id: dto.teamId, workspace_id: workspaceId } });
    if (!team) throw new NotFoundException('Team không còn trong danh sách');
    if (team.status === SpinEntryStatus.DONE) {
      throw new ConflictException(`${team.name} đã trúng ở lượt trước, hãy tải lại trang.`);
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.removeFromPool) {
        await tx.spinTeam.update({ where: { id: team.id }, data: { status: SpinEntryStatus.DONE } });
      }
      return tx.spinTeamWin.create({
        data: {
          workspace_id: workspaceId,
          team_id: team.id,
          team_name: team.name,
          created_by_id: actor.id,
          created_by_name: actor.name,
        },
      });
    });
  }

  /**
   * Trao quà: trừ tồn kho, đánh dấu người nhận và ghi lịch sử trong một transaction.
   *
   * Việc trừ kho dùng điều kiện `remaining > 0` ngay trong câu UPDATE, nên hai người cùng bấm
   * xác nhận một món quà cuối cùng thì chỉ một người thành công — người kia nhận lỗi rõ ràng
   * thay vì tồn kho tụt xuống âm.
   */
  async awardGift(slug: string, dto: AwardGiftDto, actor: SpinActor) {
    const workspaceId = await this.assertControl(slug, actor);
    const gift = await this.assertGiftInWorkspace(slug, dto.giftId);

    return this.prisma.$transaction(async (tx) => {
      const taken = await tx.spinGift.updateMany({
        where: { id: gift.id, remaining: { gt: 0 } },
        data: { remaining: { decrement: 1 } },
      });
      if (taken.count === 0) {
        throw new BadRequestException(`Quà "${gift.name}" vừa hết, có người khác đã nhận trước.`);
      }

      if (dto.recipientType === 'team') {
        const team = await tx.spinTeam.findFirst({ where: { id: dto.recipientId, workspace_id: workspaceId } });
        if (!team) throw new NotFoundException('Team nhận quà không còn trong danh sách');

        await tx.spinTeam.update({ where: { id: team.id }, data: { gift_received: true } });
        return tx.spinGiftAward.create({
          data: {
            workspace_id: workspaceId,
            team_id: team.id,
            gift_id: gift.id,
            recipient_name: `${team.name} (cả team)`,
            team_name: team.name,
            gift_name: gift.name,
            created_by_id: actor.id,
            created_by_name: actor.name,
          },
        });
      }

      const member = await tx.spinMember.findFirst({
        where: { id: dto.recipientId, workspace_id: workspaceId },
        include: { team: true },
      });
      if (!member) throw new NotFoundException('Người nhận quà không còn trong danh sách');

      await tx.spinMember.update({ where: { id: member.id }, data: { gift_received: true } });
      return tx.spinGiftAward.create({
        data: {
          workspace_id: workspaceId,
          member_id: member.id,
          gift_id: gift.id,
          recipient_name: member.name,
          team_name: member.team?.name ?? NO_TEAM_LABEL,
          gift_name: gift.name,
          created_by_id: actor.id,
          created_by_name: actor.name,
        },
      });
    });
  }

  /* ──────────────────────────── Đặt lại ──────────────────────────── */

  async resetStatuses(slug: string, dto: ResetStatusesDto, actor: SpinActor) {
    const workspaceId = await this.assertControl(slug, actor);
    if (dto.mode === 'team') {
      const r = await this.prisma.spinTeam.updateMany({
        where: { workspace_id: workspaceId },
        data: { status: SpinEntryStatus.ACTIVE },
      });
      return { reset: r.count };
    }
    const r = await this.prisma.spinMember.updateMany({
      where: { workspace_id: workspaceId },
      data: { status: SpinEntryStatus.ACTIVE },
    });
    return { reset: r.count };
  }

  /** Khôi phục tồn kho và xoá dấu đã nhận quà. Lịch sử trao quà giữ nguyên vì đó là bằng chứng. */
  async resetGifts(slug: string, actor: SpinActor) {
    const workspaceId = await this.assertControl(slug, actor);
    await this.prisma.$transaction([
      this.prisma.$executeRaw`UPDATE spin_gifts SET remaining = total WHERE workspace_id = ${workspaceId}`,
      this.prisma.spinMember.updateMany({ where: { workspace_id: workspaceId }, data: { gift_received: false } }),
      this.prisma.spinTeam.updateMany({ where: { workspace_id: workspaceId }, data: { gift_received: false } }),
    ]);
    return { reset: true };
  }

  /* ──────────────────────────── Lịch sử ──────────────────────────── */

  /**
   * Xóa một dòng lịch sử = HỦY kết quả đó, không phải chỉ giấu dòng đi.
   *
   * Người bấm xóa gần như luôn có ý hủy lượt quay vừa rồi (bấm nhầm, hoặc người trúng vắng
   * mặt). Nếu chỉ xóa dòng mà giữ nguyên trạng thái thì người đó vẫn nằm ngoài vòng quay và
   * không ai hiểu vì sao. Đây cũng chính là cơ chế đứng sau nút "Hoàn tác".
   */
  async deleteHistoryEntry(slug: string, kind: 'members' | 'teams' | 'gifts', id: string, actor: SpinActor) {
    const workspaceId = await this.assertControl(slug, actor);
    const where = { id, workspace_id: workspaceId };

    if (kind === 'members') {
      const win = await this.prisma.spinMemberWin.findFirst({ where });
      if (!win) throw new NotFoundException('Dòng lịch sử không còn tồn tại');

      await this.prisma.$transaction(async (tx) => {
        await tx.spinMemberWin.delete({ where: { id: win.id } });
        if (win.member_id) {
          await tx.spinMember.update({
            where: { id: win.member_id },
            data: { status: SpinEntryStatus.ACTIVE },
          });
        }
      });
      return { deleted: true, restored: !!win.member_id };
    }

    if (kind === 'teams') {
      const win = await this.prisma.spinTeamWin.findFirst({ where });
      if (!win) throw new NotFoundException('Dòng lịch sử không còn tồn tại');

      await this.prisma.$transaction(async (tx) => {
        await tx.spinTeamWin.delete({ where: { id: win.id } });
        if (win.team_id) {
          await tx.spinTeam.update({ where: { id: win.team_id }, data: { status: SpinEntryStatus.ACTIVE } });
        }
      });
      return { deleted: true, restored: !!win.team_id };
    }

    const award = await this.prisma.spinGiftAward.findFirst({ where });
    if (!award) throw new NotFoundException('Dòng lịch sử không còn tồn tại');

    await this.prisma.$transaction(async (tx) => {
      await tx.spinGiftAward.delete({ where: { id: award.id } });

      // Quà quay lại kho, nhưng không được vượt tổng nếu ai đó vừa sửa tổng xuống thấp hơn.
      if (award.gift_id) {
        const gift = await tx.spinGift.findUnique({ where: { id: award.gift_id } });
        if (gift) {
          await tx.spinGift.update({
            where: { id: gift.id },
            data: { remaining: Math.min(gift.remaining + 1, gift.total) },
          });
        }
      }

      // Chỉ bỏ dấu "đã nhận quà" khi người/team đó không còn phần quà nào khác.
      if (award.member_id) {
        const con = await tx.spinGiftAward.count({ where: { member_id: award.member_id } });
        if (con === 0) {
          await tx.spinMember.update({ where: { id: award.member_id }, data: { gift_received: false } });
        }
      }
      if (award.team_id) {
        const con = await tx.spinGiftAward.count({ where: { team_id: award.team_id } });
        if (con === 0) {
          await tx.spinTeam.update({ where: { id: award.team_id }, data: { gift_received: false } });
        }
      }
    });
    return { deleted: true, restored: true };
  }

  async clearHistory(slug: string, kind: 'members' | 'teams' | 'gifts', actor: SpinActor) {
    const workspaceId = await this.assertControl(slug, actor);
    const where = { workspace_id: workspaceId };

    const cleared =
      kind === 'members'
        ? await this.prisma.spinMemberWin.deleteMany({ where })
        : kind === 'teams'
          ? await this.prisma.spinTeamWin.deleteMany({ where })
          : await this.prisma.spinGiftAward.deleteMany({ where });

    return { cleared: cleared.count };
  }

  /* ──────────────────────────── Nội bộ ───────────────────────────── */

  private async assertTeamInWorkspace(slug: string, teamId: string) {
    const workspaceId = await this.resolveWorkspaceId(slug);
    const team = await this.prisma.spinTeam.findFirst({ where: { id: teamId, workspace_id: workspaceId } });
    if (!team) throw new NotFoundException('Team không thuộc vòng quay này');
    return team;
  }

  private async assertMemberInWorkspace(slug: string, memberId: string) {
    const workspaceId = await this.resolveWorkspaceId(slug);
    const member = await this.prisma.spinMember.findFirst({ where: { id: memberId, workspace_id: workspaceId } });
    if (!member) throw new NotFoundException('Thành viên không thuộc vòng quay này');
    return member;
  }

  private async assertGiftInWorkspace(slug: string, giftId: string) {
    const workspaceId = await this.resolveWorkspaceId(slug);
    const gift = await this.prisma.spinGift.findFirst({ where: { id: giftId, workspace_id: workspaceId } });
    if (!gift) throw new NotFoundException('Quà không thuộc vòng quay này');
    return gift;
  }
}
