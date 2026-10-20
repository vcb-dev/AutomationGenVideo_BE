import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { isMediaLeaderOrAdminUser } from '../../common/guards/mems-media-leader.guard';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AvailabilityService } from './availability.service';
import {
  CreateBorrowRequestDto,
  DecideExtensionDto,
  ReportIncidentDto,
  RequestExtensionDto,
} from './dto';

/**
 * Giai đoạn còn huỷ được phiếu — tất cả đều là trước khi máy rời kho.
 *
 * Từ `ON_LOAN` trở đi thì đường về duy nhất là màn Nhận trả: huỷ ở đó là bỏ rơi những chiếc đang
 * nằm ngoài công ty mà không còn phiếu nào theo dõi chúng.
 */
const CANCELLABLE_STATUSES: string[] = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PREPARING'];

/**
 * Bộ phận hứng những người chưa được gán vào đâu, để ai cũng tạo được phiếu mượn.
 *
 * Tồn tại vì bộ phận trên phiếu chỉ dùng để QUY TRÁCH NHIỆM và hiển thị: `borrow_limit` chưa
 * chặn gì, còn duyệt phiếu thì xét vai trò LEADER/MANAGER/ADMIN chứ không xét leader bộ phận.
 * Chặn người chưa có bộ phận là khoá họ khỏi một việc họ vốn được phép làm.
 */
const FALLBACK_DEPARTMENT_CODE = 'UNASSIGNED';
const FALLBACK_DEPARTMENT_NAME = 'Chưa phân bộ phận';

@Injectable()
export class BorrowRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
  ) {}

  /**
   * Bộ phận của người mượn, suy từ chính người đăng nhập.
   *
   * Client KHÔNG khai bộ phận — khai sai là quy trách nhiệm sai người, và giao diện cũng không
   * có nguồn nào để lấy con số đó. Hàm này là đường DUY NHẤT xác định bộ phận của một phiếu.
   *
   * Thứ tự tra, từ chắc chắn nhất tới suy đoán:
   *   1. Bảng thành viên MEMS, nếu ai đó đã gán
   *   2. Trường team trên hồ sơ người dùng, khớp với mã hoặc tên bộ phận
   *   3. Cả hệ thống chỉ có một bộ phận thì dùng luôn nó
   * Hết cả ba thì rơi vào bộ phận mặc định — KHÔNG chặn người dùng.
   */
  private async resolveDepartment(tx: any, ownerId: string): Promise<string> {
    const membership = await tx.memsMember.findFirst({
      where: { user_id: ownerId, is_disabled: false },
      select: { department_id: true },
    });
    if (membership) return membership.department_id;

    const user = await tx.user.findUnique({
      where: { id: ownerId },
      select: { team: true },
    });
    if (user?.team) {
      const matched = await tx.memsDepartment.findFirst({
        where: {
          is_disabled: false,
          OR: [
            { code: { equals: user.team, mode: 'insensitive' } },
            { name: { equals: user.team, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
      });
      if (matched) return matched.id;
    }

    const all = await tx.memsDepartment.findMany({ where: { is_disabled: false }, select: { id: true } });
    if (all.length === 1) return all[0].id;

    return this.fallbackDepartmentId(tx);
  }

  /**
   * Bộ phận mặc định, tạo lần đầu nếu chưa có.
   *
   * Khoá tư vấn trước khi đọc chứ không bắt lỗi trùng `code` rồi đọc lại: hai phiếu đầu tiên gửi
   * cùng lúc sẽ cùng thấy "chưa có" rồi cùng tạo, và trong một giao dịch Postgres thì câu lệnh
   * lỗi làm HỎNG cả giao dịch — đọc lại sau khi dính lỗi chỉ nhận thêm "transaction is aborted".
   * Khoá nằm SAU các khoá model và ai cũng lấy theo đúng thứ tự này nên không ôm chéo.
   */
  private async fallbackDepartmentId(tx: any): Promise<string> {
    await tx.$executeRawUnsafe(
      `SELECT pg_advisory_xact_lock(hashtext($1))`,
      `mems:department:${FALLBACK_DEPARTMENT_CODE}`,
    );

    // Không lọc `is_disabled`: bộ phận mặc định có bị tắt thì vẫn dùng lại bản ghi đó, chứ tạo
    // thêm một bản trùng mã là vỡ ràng buộc unique.
    const existing = await tx.memsDepartment.findUnique({
      where: { code: FALLBACK_DEPARTMENT_CODE },
      select: { id: true },
    });
    if (existing) return existing.id;

    const created = await tx.memsDepartment.create({
      data: { code: FALLBACK_DEPARTMENT_CODE, name: FALLBACK_DEPARTMENT_NAME },
      select: { id: true },
    });
    return created.id;
  }

  async create(ownerId: string, dto: CreateBorrowRequestDto) {
    const fromTime = new Date(dto.fromTime);
    const toTime = new Date(dto.toTime);
    if (toTime.getTime() <= fromTime.getTime()) {
      throw new BadRequestException('Thời điểm trả phải sau thời điểm nhận');
    }

    // Một model khai làm nhiều dòng là phiếu vô nghĩa: mỗi dòng hỏi khả dụng riêng nên cùng nhận
    // về "còn 1 máy", người dùng tưởng xin được 3 chiếc của model chỉ có 1. Ở đây không hỏng dữ
    // liệu — dòng sau thành Chờ hàng — nhưng phiếu mang hai dòng chờ hàng ảo mà kho không bao giờ
    // đáp ứng được. Cần nhiều máy cùng loại thì tăng số lượng của MỘT dòng.
    const seenModelIds = new Set<string>();
    for (const line of dto.lines) {
      if (seenModelIds.has(line.modelId)) {
        throw new BadRequestException(
          'Mỗi model chỉ được khai một dòng. Cần nhiều máy cùng loại thì tăng số lượng của dòng đó.',
        );
      }
      seenModelIds.add(line.modelId);
    }

    return this.prisma.$transaction(async (tx) => {
      // BR-13: kiểm tra khả dụng rồi ghi giữ chỗ phải nằm trong CÙNG một giao dịch có khoá.
      // Không có khoá thì hai người cùng xin chiếc máy cuối cùng sẽ cùng đọc "còn 1" rồi cùng
      // ghi giữ chỗ, và kho chỉ phát hiện thiếu vào đúng lúc bàn giao.
      // Khoá theo thứ tự ĐÃ SẮP, không theo thứ tự client gửi. Phiếu A xin [b, a] và phiếu B xin
      // [a, b] cùng lúc thì A giữ b đợi a, B giữ a đợi b — Postgres phát hiện deadlock và giết
      // một giao dịch, người dùng ăn 500 giữa lúc gửi phiếu. Sắp trước thì mọi giao dịch đi cùng
      // một chiều nên chỉ xếp hàng, không bao giờ ôm chéo. Vẫn lọc trùng dù khai trùng model đã
      // bị chặn ở trên: chỗ này không nên phụ thuộc vào một phép kiểm ở xa nó.
      const modelIdsToLock = [...new Set(dto.lines.map((line) => line.modelId))].sort();
      for (const modelId of modelIdsToLock) {
        await tx.$executeRawUnsafe(
          `SELECT pg_advisory_xact_lock(hashtext($1))`,
          `mems:model:${modelId}`,
        );
      }

      const departmentId = await this.resolveDepartment(tx, ownerId);
      const requestCode = await this.nextRequestCode(tx, fromTime);

      let noteValue: string | null = null;
      if (dto.note?.trim() || (dto.photos && dto.photos.length > 0)) {
        noteValue = JSON.stringify({
          text: dto.note?.trim() || '',
          photos: dto.photos || [],
        });
      }

      const request = await tx.memsBorrowRequest.create({
        data: {
          request_code: requestCode,
          owner_id: ownerId,
          department_id: departmentId,
          project: dto.project,
          place: dto.place,
          // Client cũ chưa gửi trường này; mặc định việc công ty để phiếu vẫn một cấp duyệt.
          purpose: dto.purpose ?? 'WORK',
          from_time: fromTime,
          to_time: toTime,
          status: 'PENDING_APPROVAL',
          note: noteValue,
        },
      });

      for (const line of dto.lines) {
        // Hỏi bằng chính `tx`: dòng sau phải thấy giữ chỗ mà dòng trước vừa ghi. Đọc bằng
        // `this.prisma` là đọc trên kết nối khác, không thấy bản ghi chưa commit — hai dòng
        // cùng một model sẽ cùng nhận về "còn đủ" và giữ chỗ gấp đôi số máy thực có.
        const check = await this.availability.check(
          {
            modelId: line.modelId,
            fromTime,
            toTime,
            quantity: line.quantity,
          },
          tx,
        );

        const created = await tx.memsRequestLine.create({
          data: {
            request_id: request.id,
            model_id: line.modelId,
            quantity: line.quantity,
            note: line.note ?? null,
            // QĐ-08: thiếu thì vẫn nhận phiếu, đánh dấu Chờ hàng thay vì chặn người dùng.
            status: check.enough ? 'RESERVED' : 'BACKORDERED',
          },
        });

        if (!check.enough) continue;

        // Mỗi máy MỘT bản ghi: hàm khả dụng đếm số bản ghi giữ chỗ giao nhau, không đọc số lượng.
        await tx.memsReservation.createMany({
          data: Array.from({ length: line.quantity }, () => ({
            request_line_id: created.id,
            model_id: line.modelId,
            from_time: fromTime,
            to_time: toTime,
            buffer_to_time: check.bufferedTo,
            status: 'TENTATIVE' as const,
          })),
        });
      }

      return request;
    });
  }

  /** Mã phiếu REQ-YYYYMMDD-NNN, số thứ tự đếm theo ngày nhận thiết bị. */
  private async nextRequestCode(tx: any, fromTime: Date): Promise<string> {
    const dayStart = new Date(
      Date.UTC(fromTime.getUTCFullYear(), fromTime.getUTCMonth(), fromTime.getUTCDate()),
    );
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const ymd = dayStart.toISOString().slice(0, 10).replace(/-/g, '');
    await tx.$executeRawUnsafe(
      `SELECT pg_advisory_xact_lock(hashtext($1))`,
      `mems:request-code:${ymd}`,
    );
    const used = await tx.memsBorrowRequest.count({
      where: { from_time: { gte: dayStart, lt: dayEnd } },
    });
    return `REQ-${ymd}-${String(used + 1).padStart(3, '0')}`;
  }

  /**
   * Huỷ một phiếu chưa giao máy.
   *
   * Khác TỪ CHỐI ở người bấm và ở ý nghĩa: từ chối là quản lý kho nói "không cho mượn", còn huỷ
   * là người mượn nói "tôi không cần nữa". Trước đây chỉ có đường thứ nhất, nên đặt nhầm ngày
   * hoặc buổi quay bị dời thì phiếu nằm đó giữ chỗ cho tới khi có người từ chối hộ.
   *
   * Ai huỷ được:
   *   - người đứng tên, khi phiếu CHƯA có chữ ký nào — sau khi duyệt thì kho đã bắt đầu soạn
   *     hàng, rút lui phải qua người giữ kho;
   *   - quản lý kho Media và admin, với mọi phiếu chưa bàn giao.
   *
   * Máy đã ra khỏi kho thì KHÔNG huỷ được: đường về duy nhất là màn Nhận trả. Cho huỷ ở đó là bỏ
   * rơi những chiếc đang nằm ngoài công ty mà không còn phiếu nào theo dõi chúng.
   */
  async cancel(requestId: string, actor: { id: string; roles: (string | UserRole)[]; team?: string | null }) {
    return this.prisma.$transaction(async (tx) => {
      // Cùng khoá với `ApprovalService.decide`: không thì một người bấm Huỷ đúng lúc người kia
      // bấm Duyệt, và phiếu vừa có chữ ký vừa mang trạng thái đã huỷ.
      await tx.$executeRawUnsafe(
        `SELECT pg_advisory_xact_lock(hashtext($1))`,
        `mems:request:${requestId}`,
      );

      const request = await tx.memsBorrowRequest.findUnique({ where: { id: requestId } });
      if (!request) throw new NotFoundException(`Không có phiếu ${requestId}`);

      const isKeeper = isMediaLeaderOrAdminUser(actor);
      const isOwner = request.owner_id === actor.id;
      if (!isKeeper && !isOwner) {
        throw new ForbiddenException('Phiếu này không thuộc về bạn');
      }

      if (!CANCELLABLE_STATUSES.includes(request.status)) {
        throw new ConflictException(
          `Phiếu ${request.request_code} đang ở trạng thái ${request.status}, không huỷ được nữa. ` +
            'Máy đã giao thì nhận về bằng màn Nhận trả.',
        );
      }
      if (!isKeeper && request.status !== 'PENDING_APPROVAL') {
        throw new ForbiddenException(
          `Phiếu ${request.request_code} đã được duyệt và kho đang soạn hàng. Nhờ quản lý kho huỷ giúp.`,
        );
      }

      // Nhả giữ chỗ NGAY, giống BR-32 của từ chối: để sang lượt sau thì khoảng thời gian đó vẫn
      // hiện là bận và không ai xin mượn được chiếc máy thực ra đang rảnh.
      await tx.memsReservation.updateMany({
        where: { request_line: { request_id: requestId }, status: { not: 'RELEASED' } },
        data: { status: 'RELEASED' },
      });
      await tx.memsRequestLine.updateMany({
        where: { request_id: requestId },
        data: { status: 'CANCELLED' },
      });

      return tx.memsBorrowRequest.update({
        where: { id: requestId },
        data: { status: 'CANCELLED' },
      });
    });
  }

  /**
   * Báo cáo sự cố hoặc hỏng hóc phát sinh tại hiện trường.
   */
  async reportIncident(
    requestId: string,
    actor: { id: string; roles: (string | UserRole)[]; team?: string | null },
    dto: ReportIncidentDto,
  ) {
    const request = await this.prisma.memsBorrowRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) throw new NotFoundException(`Không có phiếu ${requestId}`);

    const isKeeper = isMediaLeaderOrAdminUser(actor);
    const isOwner = request.owner_id === actor.id;
    if (!isKeeper && !isOwner) {
      throw new ForbiddenException('Bạn không có quyền báo cáo sự cố cho phiếu này');
    }

    const asset = await this.prisma.memsAsset.findUnique({
      where: { id: dto.assetId },
      include: { model: true },
    });
    if (!asset) throw new NotFoundException(`Không tìm thấy thiết bị ${dto.assetId}`);

    const incidentDescription =
      dto.description +
      (dto.photos && dto.photos.length > 0
        ? `\n\nẢnh sự cố:\n${dto.photos.join('\n')}`
        : '');

    return this.prisma.$transaction(async (tx) => {
      const incident = await tx.memsIncident.create({
        data: {
          asset_id: dto.assetId,
          request_id: requestId,
          responsible_id: request.owner_id,
          kind: (dto.kind as any) ?? 'CONDITION_WORSENED',
          description: incidentDescription,
          status: 'OPEN',
        },
      });

      await tx.memsAssetEvent.create({
        data: {
          asset_id: dto.assetId,
          kind: 'CONDITION_CHANGED',
          title: `Báo sự cố hiện trường: ${asset.asset_code}`,
          detail: dto.description,
          actor_id: actor.id,
          request_id: requestId,
        },
      });

      let currentNote: any = {};
      if (request.note) {
        try {
          const parsed = JSON.parse(request.note);
          if (parsed && typeof parsed === 'object') currentNote = parsed;
          else currentNote = { text: request.note };
        } catch {
          currentNote = { text: request.note };
        }
      }
      const incidentsList = Array.isArray(currentNote.incidents) ? currentNote.incidents : [];
      incidentsList.push({
        incident_id: incident.id,
        asset_id: dto.assetId,
        asset_code: asset.asset_code,
        kind: dto.kind ?? 'CONDITION_WORSENED',
        description: dto.description,
        photos: dto.photos ?? [],
        reported_at: new Date().toISOString(),
        reported_by: actor.id,
      });
      currentNote.incidents = incidentsList;

      await tx.memsBorrowRequest.update({
        where: { id: requestId },
        data: { note: JSON.stringify(currentNote) },
      });

      return incident;
    });
  }

  /** Lấy danh sách sự cố của một phiếu */
  async getIncidents(requestId: string) {
    return this.prisma.memsIncident.findMany({
      where: { request_id: requestId },
      include: {
        asset: {
          include: { model: { include: { category: true } } },
        },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  /**
   * Xin gia hạn phiếu mượn (Extend Loan).
   */
  async requestExtension(
    requestId: string,
    actor: { id: string; roles: (string | UserRole)[]; team?: string | null },
    dto: RequestExtensionDto,
  ) {
    const request = await this.prisma.memsBorrowRequest.findUnique({
      where: { id: requestId },
      include: { lines: { include: { model: true } } },
    });

    if (!request) throw new NotFoundException(`Không có phiếu ${requestId}`);

    const isKeeper = isMediaLeaderOrAdminUser(actor);
    const isOwner = request.owner_id === actor.id;
    if (!isKeeper && !isOwner) {
      throw new ForbiddenException('Bạn không có quyền xin gia hạn phiếu này');
    }

    if (!['ON_LOAN', 'APPROVED', 'PREPARING'].includes(request.status)) {
      throw new BadRequestException('Chỉ có thể xin gia hạn cho phiếu đang trong trạng thái mượn');
    }

    const newToTime = new Date(dto.newToTime);
    if (isNaN(newToTime.getTime()) || newToTime <= request.to_time) {
      throw new BadRequestException('Thời điểm trả mới phải sau thời điểm trả hiện tại');
    }

    for (const line of request.lines) {
      const check = await this.availability.check({
        modelId: line.model_id,
        fromTime: request.to_time,
        toTime: newToTime,
        quantity: line.quantity,
      });
      if (!check.enough) {
        throw new ConflictException(
          `Không thể gia hạn: Model ${line.model.name} đã có người khác đặt lịch trong khung giờ này`,
        );
      }
    }

    let currentNote: any = {};
    if (request.note) {
      try {
        const parsed = JSON.parse(request.note);
        if (parsed && typeof parsed === 'object') currentNote = parsed;
        else currentNote = { text: request.note };
      } catch {
        currentNote = { text: request.note };
      }
    }

    currentNote.extension = {
      requested_to_time: newToTime.toISOString(),
      reason: dto.reason.trim(),
      requested_by: actor.id,
      requested_at: new Date().toISOString(),
      status: 'PENDING',
    };

    return this.prisma.memsBorrowRequest.update({
      where: { id: requestId },
      data: { note: JSON.stringify(currentNote) },
    });
  }

  /**
   * Duyệt hoặc từ chối yêu cầu gia hạn phiếu mượn.
   */
  async decideExtension(
    requestId: string,
    actor: { id: string; roles: (string | UserRole)[]; team?: string | null },
    dto: DecideExtensionDto,
  ) {
    if (!isMediaLeaderOrAdminUser(actor)) {
      throw new ForbiddenException('Chỉ quản lý kho Media hoặc Admin mới có quyền duyệt gia hạn');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT pg_advisory_xact_lock(hashtext($1))`,
        `mems:request:${requestId}`,
      );

      const request = await tx.memsBorrowRequest.findUnique({
        where: { id: requestId },
        include: { lines: true },
      });
      if (!request) throw new NotFoundException(`Không có phiếu ${requestId}`);

      let currentNote: any = {};
      if (request.note) {
        try {
          const parsed = JSON.parse(request.note);
          if (parsed && typeof parsed === 'object') currentNote = parsed;
          else currentNote = { text: request.note };
        } catch {
          currentNote = { text: request.note };
        }
      }

      if (!currentNote.extension || currentNote.extension.status !== 'PENDING') {
        throw new BadRequestException('Phiếu này không có yêu cầu gia hạn nào đang chờ duyệt');
      }

      if (dto.decision === 'REJECTED') {
        currentNote.extension.status = 'REJECTED';
        currentNote.extension.decided_by = actor.id;
        currentNote.extension.decided_at = new Date().toISOString();
        currentNote.extension.reject_reason = dto.reason?.trim() || null;

        return tx.memsBorrowRequest.update({
          where: { id: requestId },
          data: { note: JSON.stringify(currentNote) },
        });
      }

      const newToTime = new Date(currentNote.extension.requested_to_time);
      currentNote.extension.status = 'APPROVED';
      currentNote.extension.decided_by = actor.id;
      currentNote.extension.decided_at = new Date().toISOString();

      await tx.memsReservation.updateMany({
        where: {
          request_line: { request_id: requestId },
          status: { in: ['TENTATIVE', 'CONFIRMED'] },
        },
        data: {
          to_time: newToTime,
          buffer_to_time: newToTime,
        },
      });

      return tx.memsBorrowRequest.update({
        where: { id: requestId },
        data: {
          to_time: newToTime,
          note: JSON.stringify(currentNote),
        },
      });
    });
  }

  /**
   * Cảnh báo các phiếu sắp hết hạn trả (< 2 tiếng) hoặc đang quá hạn trả.
   * Thành viên thường (Member) chỉ nhận cảnh báo cho các phiếu của chính họ.
   * Leader Media và Admin nhận cảnh báo toàn kho để đôn đốc thu hồi.
   */
  async getUpcomingReturnsAlerts(viewer?: { id: string; roles: (UserRole | string)[]; team?: string | null }) {
    const isManager = viewer ? isMediaLeaderOrAdminUser(viewer) : true;
    const ownerScope = isManager ? {} : { owner_id: viewer!.id };

    const now = new Date();
    const inTwoHours = new Date(now.getTime() + 2 * 60 * 60 * 1000);

    const onLoanRequests = await this.prisma.memsBorrowRequest.findMany({
      where: {
        status: { in: ['ON_LOAN', 'PARTIALLY_RETURNED'] },
        ...ownerScope,
      },
      include: {
        lines: {
          include: {
            model: true,
          },
        },
      },
      orderBy: { to_time: 'asc' },
    });

    const userIds = Array.from(new Set(onLoanRequests.map((r) => r.owner_id)));
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, full_name: true, email: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    const overdue: any[] = [];
    const expiringSoon: any[] = [];

    for (const r of onLoanRequests) {
      const owner = userMap.get(r.owner_id);
      const item = {
        id: r.id,
        request_code: r.request_code,
        owner_id: r.owner_id,
        project: r.project,
        place: r.place,
        from_time: r.from_time,
        to_time: r.to_time,
        owner_name: owner?.full_name ?? '—',
        owner_email: owner?.email ?? null,
        total_units: r.lines.reduce((s, l) => s + l.quantity, 0),
        status: r.status,
      };

      if (r.to_time < now) {
        overdue.push({
          ...item,
          overdue_hours: Math.round((now.getTime() - r.to_time.getTime()) / (1000 * 60 * 60)),
        });
      } else if (r.to_time <= inTwoHours) {
        expiringSoon.push({
          ...item,
          minutes_left: Math.max(0, Math.round((r.to_time.getTime() - now.getTime()) / (1000 * 60))),
        });
      }
    }

    return {
      overdueCount: overdue.length,
      expiringSoonCount: expiringSoon.length,
      overdue,
      expiringSoon,
    };
  }
}

