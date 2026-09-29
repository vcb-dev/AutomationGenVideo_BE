import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { vietnamDateString } from '../../utils/date.utils';
import { buildVoiceUsageDateRange } from '../ai-integration/voice-usage-range';
import {
  GENERATION_STATUS,
  GenerationCost,
  GenerationStatus,
  PRODUCT_IMAGE_MODE,
  ProductImageMode,
  USD_VND_RATE_ENV,
  buildCostStats,
  generationsDbError,
  parseUsdVndRate,
} from './product-image-cost.util';

export interface GenerationRecord extends GenerationCost {
  userId: string;
  mode: ProductImageMode;
  status: GenerationStatus;
  productName?: string | null;
  errorMessage?: string | null;
  durationMs: number;
}

/** Ai được bấm "Đạt"/bỏ "Đạt": chính người tạo, hoặc ADMIN/MANAGER (người xem tab Chi phí). */
const APPROVE_ANY_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.MANAGER];

/** Số lượt gần nhất trả về cho bảng "Lượt tạo gần đây" ở tab Chi phí. */
const RECENT_LIMIT = 50;

/**
 * Nhật ký từng lượt Tạo ảnh sản phẩm (bảng product_image_generations) — nguồn của tab Chi phí.
 */
@Injectable()
export class ProductImageGenerationsService {
  private readonly logger = new Logger(ProductImageGenerationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Ghi một lượt. Trả về id, hoặc null nếu ghi hỏng — thống kê là phụ, KHÔNG được làm hỏng lượt
   * tạo ảnh người dùng vừa trả tiền; lỗi ghi được log ở mức error để còn lần ra.
   */
  async record(entry: GenerationRecord): Promise<string | null> {
    try {
      const row = await this.prisma.productImageGeneration.create({
        data: {
          user_id: entry.userId,
          mode: entry.mode,
          status: entry.status,
          product_name: entry.productName?.trim().slice(0, 200) || null,
          model: entry.model,
          input_tokens: entry.input_tokens,
          output_tokens: entry.output_tokens,
          cost_usd: entry.cost_usd,
          cost_note: entry.cost_note,
          error_message: entry.errorMessage?.slice(0, 500) || null,
          duration_ms: Math.max(0, Math.round(entry.durationMs)),
        },
        select: { id: true },
      });
      return row.id;
    } catch (err: any) {
      this.logger.error(`Không ghi được lượt ${entry.mode} của user=${entry.userId}: ${err?.message ?? err}`);
      return null;
    }
  }

  /** Lỗi DB → log đủ chi tiết, người dùng chỉ thấy câu dễ hiểu (xem generationsDbError). */
  private async db<T>(action: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err: any) {
      this.logger.error(`${action}: ${err?.message ?? err}`);
      throw generationsDbError(err);
    }
  }

  async setApproved(id: string, approved: boolean, user: { id: string; roles?: UserRole[] }) {
    const row = await this.db('Đọc lượt để đánh dấu Đạt', () =>
      this.prisma.productImageGeneration.findUnique({
        where: { id },
        select: { id: true, user_id: true, mode: true, status: true },
      }),
    );
    if (!row) throw new NotFoundException('Không tìm thấy lượt tạo ảnh này');
    if (row.mode !== PRODUCT_IMAGE_MODE.HELD_PRODUCT || row.status !== GENERATION_STATUS.SUCCESS) {
      throw new BadRequestException('Chỉ ảnh Gemini tạo thành công mới đánh dấu "Đạt" được');
    }
    const canApproveAny = (user.roles ?? []).some((r) => APPROVE_ANY_ROLES.includes(r));
    if (row.user_id !== user.id && !canApproveAny) {
      throw new ForbiddenException('Chỉ người tạo ảnh (hoặc Admin/Manager) mới đánh dấu "Đạt" được');
    }
    const updated = await this.db('Lưu đánh dấu Đạt', () =>
      this.prisma.productImageGeneration.update({
        where: { id },
        data: approved ? { approved_at: new Date(), approved_by: user.id } : { approved_at: null, approved_by: null },
        select: { id: true, approved_at: true },
      }),
    );
    return { id: updated.id, approved: updated.approved_at !== null, approvedAt: updated.approved_at };
  }

  async getCostStats(dateFrom?: string, dateTo?: string) {
    // Đọc lúc dùng: thiếu tỷ giá thì chỉ tab Chi phí báo lỗi (nêu tên biến), tạo ảnh vẫn chạy.
    const rate = parseUsdVndRate(this.configService.get<string>(USD_VND_RATE_ENV));
    const range = buildVoiceUsageDateRange(dateFrom, dateTo);
    const rows = await this.db('Đọc thống kê chi phí', () =>
      this.prisma.productImageGeneration.findMany({
        where: range ? { created_at: range } : {},
        orderBy: { created_at: 'desc' },
      }),
    );
    const userIds = [...new Set(rows.map((r) => r.user_id))];
    const users = userIds.length
      ? await this.db('Đọc tên người thao tác', () =>
          this.prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, full_name: true, email: true },
          }),
        )
      : [];

    const stats = buildCostStats(
      rows.map((r) => ({ ...r, cost_usd: r.cost_usd === null ? null : Number(r.cost_usd) })),
      {
        rate,
        userNames: new Map(users.map((u) => [u.id, u.full_name || u.email])),
        toDay: vietnamDateString,
        recentLimit: RECENT_LIMIT,
      },
    );
    return { range: { date_from: dateFrom ?? null, date_to: dateTo ?? null }, ...stats };
  }
}
