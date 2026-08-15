import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { borrowDuration } from './borrow-duration';

/**
 * Lịch sử "máy này từng ai mượn".
 *
 * Mỗi `MemsHandoverLine` của một máy là MỘT lượt mượn: giao lúc `handover.received_at`, trả lúc
 * `returnLines[].returnRecord.returned_at`. Chưa có dòng trả nghĩa là máy đang ở ngoài.
 *
 * Việc tính "giữ bao lâu / trễ mấy ngày" nằm ở `borrow-duration.ts` chứ không viết tại đây —
 * nó là logic thuần, tách ra thì test được mọi ca biên mà không cần dựng Prisma.
 */

/** Vai được xem toàn bộ lịch sử của máy, không chỉ lượt của mình. */
const FULL_ACCESS_ROLES = ['ADMIN', 'MANAGER', 'LEADER'];

export interface HistoryViewer {
  id: string;
  roles: string[];
}

export interface AssetBorrowHistoryRow {
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
export class AssetBorrowHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async forAsset(
    assetId: string,
    viewer: HistoryViewer,
    now: Date = new Date(),
  ): Promise<AssetBorrowHistoryRow[]> {
    const lines = await this.prisma.memsHandoverLine.findMany({
      where: { asset_id: assetId },
      select: {
        handover: {
          select: {
            received_at: true,
            request: { select: { owner_id: true, project: true, to_time: true } },
          },
        },
        returnLines: { select: { returnRecord: { select: { returned_at: true } } } },
      },
    });

    // Lọc quyền NGAY sau khi lấy dữ liệu, trước mọi bước làm giàu: thành viên thường chỉ được
    // thấy lượt mượn của chính mình. Lọc ở tầng hiển thị thì dữ liệu người khác vẫn đã rời khỏi
    // máy chủ rồi.
    const canSeeAll = viewer.roles?.some((role) => FULL_ACCESS_ROLES.includes(role)) ?? false;
    const visible = canSeeAll
      ? lines
      : lines.filter((line) => line.handover?.request?.owner_id === viewer.id);

    const rows = visible.map((line) => {
      const request = line.handover?.request;
      const handedOverAt = line.handover?.received_at ?? null;
      const dueAt = request?.to_time ?? null;
      // Một dòng bàn giao chỉ được nhận lại một lần; lấy mốc trả đầu tiên tìm thấy.
      const returnedAt = line.returnLines?.[0]?.returnRecord?.returned_at ?? null;

      const duration = borrowDuration({ handedOverAt, dueAt, returnedAt, now });

      return {
        borrowerId: request?.owner_id ?? '',
        borrowerName: null as string | null,
        project: request?.project ?? null,
        handedOverAt,
        dueAt,
        returnedAt,
        ...duration,
      };
    });

    rows.sort(
      (a, b) => (b.handedOverAt?.getTime() ?? 0) - (a.handedOverAt?.getTime() ?? 0),
    );

    return this.attachBorrowerNames(rows);
  }

  /** Gắn sẵn tên người mượn để giao diện khỏi phải gọi thêm một vòng nữa. */
  private async attachBorrowerNames(
    rows: AssetBorrowHistoryRow[],
  ): Promise<AssetBorrowHistoryRow[]> {
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
