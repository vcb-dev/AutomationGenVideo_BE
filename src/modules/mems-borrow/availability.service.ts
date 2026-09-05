import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AvailabilityResult, computeAvailability } from './availability';

export interface CheckAvailabilityArgs {
  modelId: string;
  fromTime: Date;
  toTime: Date;
  quantity: number;
}

export interface CheckAvailabilityOutput extends AvailabilityResult {
  enough: boolean;
  shortBy: number;
  bufferMinutes: number;
  bufferedTo: Date;
}

/** Trạng thái loại khỏi tổng máy dùng được (BR-14, cộng thêm BR-05 mà công thức gốc bỏ sót). */
const NOT_USABLE_STATUSES = [
  'PENDING_INSPECTION',
  'BROKEN',
  'LOST',
  'DISPOSED',
] as const;

/**
 * Bốn bảng mà phép đếm khả dụng cần đọc — không hơn.
 *
 * Khai hẹp như vậy để cả `PrismaService` lẫn client của một giao dịch đang mở đều truyền vào
 * được, mà người đọc vẫn thấy ngay hàm này chạm tới đúng những gì.
 */
export type AvailabilityReadClient = Pick<
  PrismaService,
  'memsAssetModel' | 'memsAsset' | 'memsReservation' | 'memsMaintenance'
>;

@Injectable()
export class AvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * BR-11: không tồn tại khái niệm khả dụng chung chung. Mọi lời gọi đều phải kèm khoảng thời gian.
   *
   * Đây là cửa duy nhất để hỏi khả dụng. Màn hình nào tự viết phép trừ riêng là sai — hai chỗ
   * tính hai kiểu thì người dùng sẽ thấy hai con số khác nhau cho cùng một chiếc máy.
   */
  async check(
    args: CheckAvailabilityArgs,
    client: AvailabilityReadClient = this.prisma,
  ): Promise<CheckAvailabilityOutput> {
    const model = await client.memsAssetModel.findUniqueOrThrow({
      where: { id: args.modelId },
      include: { category: true },
    });

    const bufferMinutes = model.category.buffer_minutes;
    const bufferedTo = new Date(args.toTime.getTime() + bufferMinutes * 60_000);

    const totalUsableAssets = await client.memsAsset.count({
      where: {
        model_id: args.modelId,
        is_disabled: false,
        status: { notIn: [...NOT_USABLE_STATUSES] as any },
      },
    });

    // Điều kiện giao nhau đẩy xuống DB để không kéo cả bảng giữ chỗ về ứng dụng.
    const reservations = await client.memsReservation.findMany({
      where: {
        model_id: args.modelId,
        status: { in: ['TENTATIVE', 'CONFIRMED'] as any },
        from_time: { lt: bufferedTo },
        buffer_to_time: { gt: args.fromTime },
      },
      select: { from_time: true, buffer_to_time: true },
    });

    const maintenances = await client.memsMaintenance.findMany({
      where: {
        asset: { model_id: args.modelId },
        from_time: { lt: bufferedTo },
        OR: [{ to_time: null }, { to_time: { gt: args.fromTime } }],
      },
      select: { from_time: true, to_time: true },
    });

    const result = computeAvailability({
      totalUsableAssets,
      reservations: reservations.map((r) => ({
        fromTime: r.from_time,
        toTime: r.buffer_to_time,
      })),
      maintenances: maintenances.map((m) => ({
        fromTime: m.from_time,
        toTime: m.to_time,
      })),
      requestedFrom: args.fromTime,
      requestedTo: bufferedTo,
    });

    return {
      ...result,
      enough: result.available >= args.quantity,
      shortBy: Math.max(0, args.quantity - result.available),
      bufferMinutes,
      bufferedTo,
    };
  }

  /**
   * Danh sách MÁY CỤ THỂ còn rảnh trong khoảng — dùng cho bước gán serial.
   *
   * Khác `check()` ở chỗ nó xét từng máy chứ không đếm tổng. Giữ chỗ ở mức model (chưa ghim máy)
   * KHÔNG chặn một máy cụ thể nào: đó là ý của QĐ-01, phiếu chỉ đặt "một chiếc A7 IV" nên kho
   * còn tự do chọn chiếc nào. Chỉ giữ chỗ đã ghim `asset_id` mới loại máy đó ra.
   */
  async freeAssets(args: { modelId: string; fromTime: Date; toTime: Date }) {
    const model = await this.prisma.memsAssetModel.findUniqueOrThrow({
      where: { id: args.modelId },
      include: { category: true },
    });
    const bufferedTo = new Date(
      args.toTime.getTime() + model.category.buffer_minutes * 60_000,
    );

    const assets = await this.prisma.memsAsset.findMany({
      where: {
        model_id: args.modelId,
        is_disabled: false,
        status: { notIn: [...NOT_USABLE_STATUSES] as any },
      },
      include: { location: true },
      orderBy: { asset_code: 'asc' },
    });

    const pinned = await this.prisma.memsReservation.findMany({
      where: {
        model_id: args.modelId,
        asset_id: { not: null },
        status: { in: ['TENTATIVE', 'CONFIRMED'] as any },
        from_time: { lt: bufferedTo },
        buffer_to_time: { gt: args.fromTime },
      },
      select: { asset_id: true },
    });

    const busyMaintenance = await this.prisma.memsMaintenance.findMany({
      where: {
        asset: { model_id: args.modelId },
        from_time: { lt: bufferedTo },
        OR: [{ to_time: null }, { to_time: { gt: args.fromTime } }],
      },
      select: { asset_id: true },
    });

    const busy = new Set([
      ...pinned.map((p) => p.asset_id as string),
      ...busyMaintenance.map((m) => m.asset_id),
    ]);
    return assets.filter((a) => !busy.has(a.id));
  }
}
