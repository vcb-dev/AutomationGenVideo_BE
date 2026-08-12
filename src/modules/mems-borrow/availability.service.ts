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

@Injectable()
export class AvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * BR-11: không tồn tại khái niệm khả dụng chung chung. Mọi lời gọi đều phải kèm khoảng thời gian.
   *
   * Đây là cửa duy nhất để hỏi khả dụng. Màn hình nào tự viết phép trừ riêng là sai — hai chỗ
   * tính hai kiểu thì người dùng sẽ thấy hai con số khác nhau cho cùng một chiếc máy.
   */
  async check(args: CheckAvailabilityArgs): Promise<CheckAvailabilityOutput> {
    const model = await this.prisma.memsAssetModel.findUniqueOrThrow({
      where: { id: args.modelId },
      include: { category: true },
    });

    const bufferMinutes = model.category.buffer_minutes;
    const bufferedTo = new Date(args.toTime.getTime() + bufferMinutes * 60_000);

    const totalUsableAssets = await this.prisma.memsAsset.count({
      where: {
        model_id: args.modelId,
        is_disabled: false,
        status: { notIn: [...NOT_USABLE_STATUSES] as any },
      },
    });

    // Điều kiện giao nhau đẩy xuống DB để không kéo cả bảng giữ chỗ về ứng dụng.
    const reservations = await this.prisma.memsReservation.findMany({
      where: {
        model_id: args.modelId,
        status: { in: ['TENTATIVE', 'CONFIRMED'] as any },
        from_time: { lt: bufferedTo },
        buffer_to_time: { gt: args.fromTime },
      },
      select: { from_time: true, buffer_to_time: true },
    });

    const maintenances = await this.prisma.memsMaintenance.findMany({
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
}
