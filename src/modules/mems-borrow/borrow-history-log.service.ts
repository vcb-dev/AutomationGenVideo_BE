import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { borrowDuration } from './borrow-duration';

/**
 * Nhật ký toàn bộ lượt mượn của cả kho.
 *
 * Khác `asset-borrow-history.service.ts` ở góc nhìn: bên kia trả lời "máy này từng ai mượn",
 * bên này nhìn ngang toàn kho nên câu hỏi đổi thành "ai đang giữ gì và có quá hạn không".
 *
 * Quyền xem (chỉ ADMIN/quản lý kho) chốt ở controller bằng `@Roles`, KHÔNG chốt trong đây —
 * service này luôn trả toàn kho, ai gọi được thì thấy hết. Đặt hai lớp kiểm quyền ở hai nơi là
 * sớm muộn lệch nhau.
 */

/** Trần một trang. Bấm lọc một cái mà kéo cả kho về thì trang treo và DB gánh vô ích. */
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;
/**
 * Trần số dòng quét khi lọc theo trạng thái. Trạng thái phải tính trong bộ nhớ nên không phân
 * trang trước được; đặt trần để một lần bấm lọc không kéo cả bảng bàn giao về. Kho vài năm cũng
 * chỉ tới hàng nghìn dòng nên mức này dư, mà vẫn có chốt chặn nếu dữ liệu phình bất thường.
 */
const STATUS_FILTER_SCAN_LIMIT = 2000;

export interface BorrowHistoryLogQuery {
  /** HOLDING = đang giữ (chưa trả) · OVERDUE = đang giữ và đã trễ · RETURNED = đã trả */
  status?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface BorrowHistoryLogRow {
  assetId: string;
  assetCode: string;
  borrowerId: string;
  borrowerName: string | null;
  project: string | null;
  handedOverAt: Date | null;
  dueAt: Date | null;
  returnedAt: Date | null;
  status: 'HOLDING' | 'OVERDUE' | 'RETURNED' | 'UNKNOWN';
  heldDays: number | null;
  lateDays: number | null;
}

@Injectable()
export class BorrowHistoryLogService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: BorrowHistoryLogQuery, now: Date = new Date()) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(query.pageSize) || DEFAULT_PAGE_SIZE));

    // Lọc khoảng ngày đẩy xuống DB, không lấy hết về rồi lọc trong bộ nhớ: kho chạy vài năm là
    // bảng bàn giao lên hàng chục nghìn dòng.
    const where: any = {};
    if (query.from || query.to) {
      where.handover = { received_at: {} };
      if (query.from) where.handover.received_at.gte = new Date(query.from);
      if (query.to) {
        // `to` là ngày, phải lấy trọn ngày đó chứ không cắt ở 00:00 — nếu không thì lọc tới
        // hôm nay sẽ mất sạch lượt giao trong ngày.
        const end = new Date(query.to);
        end.setHours(23, 59, 59, 999);
        where.handover.received_at.lte = end;
      }
    }

    // Trạng thái (đang giữ / quá hạn / đã trả) là số TÍNH RA từ ba mốc thời gian, không phải cột
    // trong DB — nên không đẩy được xuống SQL. Khi có lọc trạng thái thì phải lấy trọn tập đã
    // giới hạn theo ngày, tính trạng thái, lọc, RỒI mới cắt trang: phân trang trước khi lọc thì
    // `total` đếm cả dòng bị loại, và màn hình rơi vào cảnh bảng trống mà góc phải vẫn ghi "2 lượt".
    const filteringByStatus = Boolean(query.status);
    const skip: number = filteringByStatus ? 0 : (page - 1) * pageSize;
    const take: number = filteringByStatus ? STATUS_FILTER_SCAN_LIMIT : pageSize;

    const [lines, countedTotal] = await Promise.all([
      this.prisma.memsHandoverLine.findMany({
        where,
        skip,
        take,
        orderBy: { handover: { received_at: 'desc' } },
        select: {
          asset: { select: { id: true, asset_code: true } },
          handover: {
            select: {
              received_at: true,
              request: { select: { owner_id: true, project: true, to_time: true } },
            },
          },
          returnLines: { select: { returnRecord: { select: { returned_at: true } } } },
        },
      }),
      this.prisma.memsHandoverLine.count({ where }),
    ]);

    let rows: BorrowHistoryLogRow[] = lines.map((line) => {
      const request = line.handover?.request;
      const handedOverAt = line.handover?.received_at ?? null;
      const dueAt = request?.to_time ?? null;
      const returnedAt = line.returnLines?.[0]?.returnRecord?.returned_at ?? null;

      return {
        assetId: line.asset?.id ?? '',
        assetCode: line.asset?.asset_code ?? '',
        borrowerId: request?.owner_id ?? '',
        borrowerName: null as string | null,
        project: request?.project ?? null,
        handedOverAt,
        dueAt,
        returnedAt,
        ...borrowDuration({ handedOverAt, dueAt, returnedAt, now }),
      };
    });

    rows.sort((a, b) => (b.handedOverAt?.getTime() ?? 0) - (a.handedOverAt?.getTime() ?? 0));

    let total = countedTotal;
    if (filteringByStatus) {
      rows = rows.filter((row) => row.status === query.status);
      // Đếm SAU khi lọc: đây mới là con số khớp với những gì người dùng nhìn thấy.
      total = rows.length;
      rows = rows.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
    }

    return { rows: await this.attachBorrowerNames(rows), total, page, pageSize };
  }

  private async attachBorrowerNames(rows: BorrowHistoryLogRow[]): Promise<BorrowHistoryLogRow[]> {
    const ids = [...new Set(rows.map((row) => row.borrowerId).filter(Boolean))];
    if (ids.length === 0) return rows;

    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, full_name: true },
    });
    const nameById = new Map(users.map((user) => [user.id, user.full_name]));

    return rows.map((row) => ({ ...row, borrowerName: nameById.get(row.borrowerId) ?? null }));
  }
}
