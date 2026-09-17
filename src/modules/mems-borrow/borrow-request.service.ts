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
import { CreateBorrowRequestDto } from './dto';

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
    const used = await tx.memsBorrowRequest.count({
      where: { from_time: { gte: dayStart, lt: dayEnd } },
    });
    const ymd = dayStart.toISOString().slice(0, 10).replace(/-/g, '');
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
}
