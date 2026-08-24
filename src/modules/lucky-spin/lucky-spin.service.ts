import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
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
  hasReducedOdds,
  REDUCED_ODDS_RATE,
  RECENT_WINNER_COOLDOWN_ROUNDS,
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

/**
 * User đang thao tác — vừa để ghi lịch sử ai bấm xác nhận, vừa để chọn đúng vòng quay của họ.
 *
 * `id` bắt buộc từ khi mỗi tài khoản có vòng quay riêng: thiếu id thì không biết mở kho dữ liệu
 * của ai. Mọi endpoint đều đứng sau JwtAuthGuard nên chỗ này luôn có giá trị.
 */
export interface SpinActor {
  id: string;
  name?: string;
}

@Injectable()
export class LuckySpinService {
  constructor(private readonly prisma: PrismaService) {}

  /* ─────────────────────────── Workspace ─────────────────────────── */

  /**
   * Lấy id vòng quay của MỘT tài khoản theo slug, tự tạo nếu chưa có.
   *
   * Đây là chốt chặn duy nhất của toàn module: bảy bảng con đều tham chiếu `workspace_id`, nên
   * khoá theo cặp (slug, tài khoản) ở đây là dữ liệu tự động tách theo từng người. Trước đây
   * khoá theo mỗi slug, tức là cả công ty ghi đè lên nhau trong cùng một kho.
   *
   * Vẫn giữ lối tự tạo khi chưa có: tài khoản mới mở trang lần đầu là có ngay vòng quay rỗng
   * của mình, môi trường mới không cần seed, và không có đường nào tạo ra slug lạ ngoài danh
   * sách khai trong code.
   */
  private async resolveWorkspaceId(slug: string, ownerId: string): Promise<string> {
    const known = SPIN_WORKSPACES.find((w) => w.slug === slug);
    if (!known) throw new NotFoundException(`Không có vòng quay "${slug}"`);
    // Không có tài khoản thì dừng hẳn. Rơi về một vòng quay không chủ nghĩa là mở lại đúng cái
    // kho dùng chung mà thay đổi này sinh ra để dẹp.
    if (!ownerId) throw new UnauthorizedException('Không xác định được tài khoản đang đăng nhập.');

    const ws = await this.prisma.spinWorkspace.upsert({
      where: { slug_owner_id: { slug: known.slug, owner_id: ownerId } },
      update: {},
      create: { slug: known.slug, name: known.name, order_index: known.orderIndex, owner_id: ownerId },
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
    const workspaceId = await this.resolveWorkspaceId(slug, actor.id);
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
    const workspaceId = await this.resolveWorkspaceId(slug, actor.id);
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
    const workspaceId = await this.resolveWorkspaceId(slug, actor.id);
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
  async getState(slug: string, ownerId: string) {
    const workspaceId = await this.resolveWorkspaceId(slug, ownerId);
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
        avatarUrl: m.avatar_url ?? undefined,
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
        avatarUrl: h.avatar_url ?? undefined,
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
  async listFullHistory(slug: string, kind: 'members' | 'teams' | 'gifts', ownerId: string) {
    const workspaceId = await this.resolveWorkspaceId(slug, ownerId);
    const where = { workspace_id: workspaceId };
    const orderBy = { created_at: 'desc' as const };

    if (kind === 'members') {
      const rows = await this.prisma.spinMemberWin.findMany({ where, orderBy });
      return rows.map((h) => ({
        id: h.id,
        memberId: h.member_id ?? '',
        name: h.member_name,
        team: h.team_name,
        avatarUrl: h.avatar_url ?? undefined,
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

    // Nếu FE gửi lên thứ tự các ô đã xáo trộn (người dùng bấm "Xáo trộn vị trí"):
    if (dto.orderedPoolIds && Array.isArray(dto.orderedPoolIds) && dto.orderedPoolIds.length > 0) {
      const poolMap = new Map(pool.map((p) => [p.id, p]));
      const ordered: typeof pool = [];
      for (const id of dto.orderedPoolIds) {
        const item = poolMap.get(id);
        if (item) {
          ordered.push(item);
          poolMap.delete(id);
        }
      }
      for (const item of poolMap.values()) {
        ordered.push(item);
      }
      if (ordered.length === pool.length) {
        pool = ordered;
      }
    }

    const soLuongBoc = kind === SpinRoundKind.GIFT ? 1 : count;

    // Lấy ID người vừa trúng trong 1-2 lượt quay gần nhất để kích hoạt Anti-Repeat Cooldown
    const recentRounds =
      (await this.prisma.spinRound?.findMany?.({
        where: { workspace_id: workspaceId, kind },
        orderBy: { started_at: 'desc' },
        take: RECENT_WINNER_COOLDOWN_ROUNDS,
      })) ?? [];
    const recentWinnerIds = new Set<string>();
    for (const r of recentRounds) {
      if (r?.winner_indexes && r?.pool_ids) {
        for (const idx of r.winner_indexes) {
          const id = r.pool_ids[idx];
          if (id) recentWinnerIds.add(id);
        }
      }
    }


    const winnerIndexes = this.pickWinners(pool, soLuongBoc, kind, recentWinnerIds);

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
   * Chọn người thắng, có tính danh sách hạn chế và cơ chế Anti-Repeat Cooldown (1-2 lượt).
   *
   * 1. Người trong REDUCED_ODDS_NAMES (Toán & Hiếu): mỗi người tung riêng 1%, trúng thì chiếm suất.
   * 2. Người thường: ưu tiên bốc trong số người CHƯA trúng ở 1-2 lượt gần nhất.
   *    Nếu không đủ người mới (ví dụ pool chỉ có 1-2 người), tự động quay lại bốc trong nhóm vừa trúng.
   * 3. Hết người thường mà vẫn thiếu suất: chia đều cho những người hạn chế chưa trúng.
   */
  private pickWinners(
    pool: { id: string; name: string }[],
    count: number,
    kind: SpinRoundKind,
    recentWinnerIds: Set<string> = new Set(),
  ): number[] {
    const allIndexes = pool.map((_, i) => i);
    if (kind !== SpinRoundKind.MEMBER) {
      const fresh = allIndexes.filter((i) => !recentWinnerIds.has(pool[i].id));
      const recent = allIndexes.filter((i) => recentWinnerIds.has(pool[i].id));
      const winners: number[] = [];
      const fromFresh = Math.min(fresh.length, count);
      winners.push(...this.pickDistinctIndexes(fresh, fromFresh));
      const remaining = count - winners.length;
      if (remaining > 0) {
        winners.push(...this.pickDistinctIndexes(recent, remaining));
      }
      return this.pickDistinctIndexes(winners, winners.length);
    }

    const restricted = allIndexes.filter((i) => hasReducedOdds(pool[i].name));
    const normal = allIndexes.filter((i) => !hasReducedOdds(pool[i].name));

    // Phân tách người thường: người chưa trúng gần đây (ưu tiên) vs người vừa trúng 1-2 lượt trước (hồi chiêu)
    const normalFresh = normal.filter((i) => !recentWinnerIds.has(pool[i].id));
    const normalRecent = normal.filter((i) => recentWinnerIds.has(pool[i].id));

    const winners: number[] = [];
    for (const i of restricted) {
      if (winners.length >= count) break;
      if (this.nextUnitRandom() < REDUCED_ODDS_RATE) winners.push(i);
    }

    let remaining = count - winners.length;
    if (remaining > 0) {
      // 1. Ưu tiên bốc trong số người thường chưa trúng trong 1-2 lượt gần nhất:
      const fromFresh = Math.min(normalFresh.length, remaining);
      winners.push(...this.pickDistinctIndexes(normalFresh, fromFresh));
      remaining -= fromFresh;
    }

    if (remaining > 0 && normalRecent.length > 0) {
      // 2. Nếu không đủ người chưa trúng (ví dụ danh sách ít người), bốc tiếp trong số người vừa trúng:
      const fromRecent = Math.min(normalRecent.length, remaining);
      winners.push(...this.pickDistinctIndexes(normalRecent, fromRecent));
      remaining -= fromRecent;
    }

    // 3. Hết người thường mà vẫn thiếu suất: chia đều cho những người hạn chế chưa trúng.
    if (remaining > 0) {
      const leftover = restricted.filter((i) => !winners.includes(i));
      winners.push(...this.pickDistinctIndexes(leftover, remaining));
    }

    // Trộn toàn bộ: pickDistinctIndexes với count = độ dài chính là Fisher-Yates đầy đủ.
    return this.pickDistinctIndexes(winners, winners.length);
  }


  /** Số thực trong [0, 1) lấy từ crypto — không dùng Math.random để kết quả không đoán được. */
  private nextUnitRandom(): number {
    return randomInt(0, 2 ** 30) / 2 ** 30;
  }

  /**
   * Fisher-Yates một phần bằng crypto — không lặp người, không lệch phân phối.
   *
   * Nhận sẵn danh sách ô được phép thắng thay vì kích thước bánh xe, vì hai con số này không
   * còn bằng nhau từ khi có danh sách hạn chế.
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
    await this.assertTeamInWorkspace(slug, teamId, actor.id);
    return this.prisma.spinTeam.update({
      where: { id: teamId },
      data: { ...(dto.name !== undefined && { name: dto.name.trim() }) },
    });
  }

  async deleteTeam(slug: string, teamId: string, actor: SpinActor) {
    await this.assertControl(slug, actor);
    await this.assertTeamInWorkspace(slug, teamId, actor.id);
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
    await this.assertTeamInWorkspace(slug, dto.teamId, actor.id);
    return this.prisma.spinMember.create({
      data: {
        workspace_id: workspaceId,
        team_id: dto.teamId,
        name: dto.name.trim(),
        avatar_url: dto.avatarUrl?.trim() || null,
      },
    });
  }

  /**
   * Nhập hàng loạt từ file Excel — THAY danh sách cũ, không cộng dồn.
   *
   * Bản đầu chỉ createMany nên nhập lại đúng file vừa nhập là danh sách nhân đôi: mỗi người
   * hiện hai lần trên bánh xe và có gấp đôi cơ hội trúng. Mà sửa vài dòng Excel rồi nhập lại
   * chính là thao tác hay dùng nhất giữa buổi sự kiện.
   *
   * Xoá được vì lược đồ đã tính trước: spin_member_wins chụp sẵn member_name/team_name và FK
   * để onDelete SetNull, nên biên bản buổi đã quay không đổi.
   *
   * Team bị xoá theo (chốt với ban tổ chức 12/08/2026): team vốn TỰ SINH từ chính file này,
   * giữ lại thì team rỗng không còn ai vẫn nằm trong vòng quay team và vẫn bốc trúng được.
   *
   * Chạy trong một transaction: đã xoá xong mà phần ghi hỏng giữa chừng thì sự kiện mất sạch
   * danh sách, không có đường lùi.
   */
  async bulkCreateMembers(slug: string, dto: BulkCreateMembersDto, actor: SpinActor) {
    const workspaceId = await this.assertControl(slug, actor);

    // Lọc TRƯỚC khi đụng vào DB: file trắng hoặc file toàn dòng thiếu cột không được phép
    // quét sạch danh sách đang chạy. Chọn nhầm file giữa buổi là chuyện có thật.
    const rows = dto.members
      .map((r) => ({
        name: r.name.trim(),
        teamName: r.teamName.trim(),
        avatarUrl: r.avatarUrl?.trim() || null,
      }))
      .filter((r) => r.name && r.teamName);

    if (rows.length === 0) {
      return { createdMembers: 0, createdTeams: 0, deletedMembers: 0, deletedTeams: 0 };
    }

    return this.prisma.$transaction(async (tx) => {
      // Member trước, team sau: team_id là SetNull nên đảo lại vẫn chạy, nhưng xoá member
      // trước thì không có khoảnh khắc nào tồn tại member mồ côi giữa hai lệnh.
      const { count: deletedMembers } = await tx.spinMember.deleteMany({ where: { workspace_id: workspaceId } });
      const { count: deletedTeams } = await tx.spinTeam.deleteMany({ where: { workspace_id: workspaceId } });

      // Dựng lại bảng tên từ ĐẦU, không đọc lại team cũ: chúng vừa bị xoá ngay trên.
      const teamIdByLowerName = new Map<string, string>();
      let createdTeams = 0;
      const membersData: Prisma.SpinMemberCreateManyInput[] = [];

      for (const row of rows) {
        let teamId = teamIdByLowerName.get(row.teamName.toLowerCase());
        if (!teamId) {
          const created = await tx.spinTeam.create({
            data: { workspace_id: workspaceId, name: row.teamName },
            select: { id: true },
          });
          teamId = created.id;
          teamIdByLowerName.set(row.teamName.toLowerCase(), teamId);
          createdTeams++;
        }
        membersData.push({
          workspace_id: workspaceId,
          team_id: teamId,
          name: row.name,
          avatar_url: row.avatarUrl,
        });
      }

      await tx.spinMember.createMany({ data: membersData });
      return { createdMembers: membersData.length, createdTeams, deletedMembers, deletedTeams };
    });
  }

  async updateMember(slug: string, memberId: string, dto: UpdateMemberDto, actor: SpinActor) {
    await this.assertControl(slug, actor);
    await this.assertMemberInWorkspace(slug, memberId, actor.id);
    if (dto.teamId) await this.assertTeamInWorkspace(slug, dto.teamId, actor.id);
    return this.prisma.spinMember.update({
      where: { id: memberId },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.teamId !== undefined && { team_id: dto.teamId }),
        ...(dto.avatarUrl !== undefined && { avatar_url: dto.avatarUrl?.trim() || null }),
      },
    });
  }

  async deleteMember(slug: string, memberId: string, actor: SpinActor) {
    await this.assertControl(slug, actor);
    await this.assertMemberInWorkspace(slug, memberId, actor.id);
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

  /**
   * Nhập quà từ Excel — THAY danh sách cũ, cùng lý do đã ghi ở bulkCreateMembers.
   *
   * Lịch sử trao quà an toàn: spin_gift_awards chụp sẵn gift_name và FK là SetNull.
   */
  async bulkCreateGifts(slug: string, dto: BulkCreateGiftsDto, actor: SpinActor) {
    const workspaceId = await this.assertControl(slug, actor);
    const data = dto.gifts
      .filter((g) => g.name.trim() && g.total > 0)
      .map((g) => ({ workspace_id: workspaceId, name: g.name.trim(), total: g.total, remaining: g.total }));

    // File trắng / toàn dòng hỏng thì giữ nguyên danh sách đang chạy — xem ghi chú ở bulkCreateMembers.
    if (data.length === 0) return { createdGifts: 0, deletedGifts: 0 };

    return this.prisma.$transaction(async (tx) => {
      const { count: deletedGifts } = await tx.spinGift.deleteMany({ where: { workspace_id: workspaceId } });
      await tx.spinGift.createMany({ data });
      return { createdGifts: data.length, deletedGifts };
    });
  }

  async updateGift(slug: string, giftId: string, dto: UpdateGiftDto, actor: SpinActor) {
    await this.assertControl(slug, actor);
    const gift = await this.assertGiftInWorkspace(slug, giftId, actor.id);
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
    await this.assertGiftInWorkspace(slug, giftId, actor.id);
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
          avatar_url: member.avatar_url ?? null,
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
    const gift = await this.assertGiftInWorkspace(slug, dto.giftId, actor.id);

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

  // Ba hàm dưới đây là chỗ chặn cách ly quan trọng nhất: chúng ngăn tài khoản này sửa hay xoá
  // dữ liệu của tài khoản kia bằng cách đoán id. Bỏ sót `ownerId` ở một hàm là thủng cả module.

  private async assertTeamInWorkspace(slug: string, teamId: string, ownerId: string) {
    const workspaceId = await this.resolveWorkspaceId(slug, ownerId);
    const team = await this.prisma.spinTeam.findFirst({ where: { id: teamId, workspace_id: workspaceId } });
    if (!team) throw new NotFoundException('Team không thuộc vòng quay này');
    return team;
  }

  private async assertMemberInWorkspace(slug: string, memberId: string, ownerId: string) {
    const workspaceId = await this.resolveWorkspaceId(slug, ownerId);
    const member = await this.prisma.spinMember.findFirst({ where: { id: memberId, workspace_id: workspaceId } });
    if (!member) throw new NotFoundException('Thành viên không thuộc vòng quay này');
    return member;
  }

  private async assertGiftInWorkspace(slug: string, giftId: string, ownerId: string) {
    const workspaceId = await this.resolveWorkspaceId(slug, ownerId);
    const gift = await this.prisma.spinGift.findFirst({ where: { id: giftId, workspace_id: workspaceId } });
    if (!gift) throw new NotFoundException('Quà không thuộc vòng quay này');
    return gift;
  }
}
