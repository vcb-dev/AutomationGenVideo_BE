import { Injectable, Logger } from "@nestjs/common";
import { DateTime } from "luxon";
import { PrismaService } from "../../../common/prisma/prisma.service";
import { pickWinningLink, WinningLink } from "./published-link-win-fail.util";

// Nhãn "Win" sẵn có cho content tự đẩy lên kho tổng — tìm-hoặc-tạo theo tên (name unique), không hard-code id.
const CONTENT_WIN_CLASSIFICATION_NAME = "Win";

type WinningTaskRow = {
  id: string;
  assignee_id: string | null;
  reviewed_by_id: string | null;
  brand_type: string | null;
  content_id: string | null;
  team_content_id: string | null;
  editor_content_id: string | null;
  content_line_id: string | null;
  team: { market: string; brand_type: string } | null;
  content_line: { name: string } | null;
};

/**
 * Luồng "content win → tự đẩy về kho tổng". Khi 1 task APPROVED có link bài đăng >
 * VIEW_WIN_THRESHOLD view (xem published-link-win-fail.util.ts): lấy/tạo 1 row Content ở kho
 * tổng (global → dùng thẳng; team/editor content → tạo bản mirror; không gắn content → tạo mới
 * từ video thắng, dedupe theo win_video_url), thêm vào ContentWarehouse tháng hiện tại, gắn
 * nhãn "Win" + lưu link view cao nhất (chỉ lần đầu), rồi set Task.content_win_pushed_at.
 *
 * Gọi từ cron 8:15 và nút "Cập nhật" Content Win/Fail. Idempotent, không bao giờ throw ra ngoài.
 */
@Injectable()
export class TaskAutoContentWinPushService {
  private readonly logger = new Logger(TaskAutoContentWinPushService.name);

  constructor(private prisma: PrismaService) {}

  private currentMonth(): string {
    return DateTime.now().setZone("Asia/Ho_Chi_Minh").toFormat("yyyy-MM");
  }

  async pushWinningTasks(
    taskIds: string[],
  ): Promise<{ pushed: number; skipped: number; failed: number }> {
    const ids = Array.from(new Set(taskIds)).filter(Boolean);
    if (ids.length === 0) return { pushed: 0, skipped: 0, failed: 0 };

    const tasks = await this.prisma.task.findMany({
      where: { id: { in: ids }, status: "APPROVED", content_win_pushed_at: null },
      select: {
        id: true,
        assignee_id: true,
        reviewed_by_id: true,
        brand_type: true,
        content_id: true,
        team_content_id: true,
        editor_content_id: true,
        content_line_id: true,
        published_links: true,
        team: { select: { market: true, brand_type: true } },
        content_line: { select: { name: true } },
      },
    });

    // Task bị loại ngay từ query (chưa APPROVED / đã đẩy / không tồn tại) tính là "skipped".
    let pushed = 0;
    let skipped = ids.length - tasks.length;
    let failed = 0;

    for (const task of tasks) {
      const win = pickWinningLink(task.published_links as any);
      if (!win) {
        skipped++;
        continue;
      }
      try {
        await this.pushOne(task as unknown as WinningTaskRow, win);
        pushed++;
      } catch (err: any) {
        failed++;
        this.logger.warn(
          `[content-win-push] Task ${task.id} lỗi: ${err?.message ?? err}`,
        );
      }
    }

    if (pushed || failed) {
      this.logger.log(
        `[content-win-push] Xong: ${pushed} đẩy lên kho tổng, ${skipped} bỏ qua, ${failed} lỗi`,
      );
    }
    return { pushed, skipped, failed };
  }

  private async pushOne(task: WinningTaskRow, win: WinningLink): Promise<void> {
    const contentWinClassificationId = await this.getContentWinClassificationId();
    const contentId = await this.resolveGlobalContentId(
      task,
      win,
      contentWinClassificationId,
    );

    if (!contentId) {
      this.logger.warn(
        `[content-win-push] Task ${task.id} không đủ dữ liệu để tạo content (thiếu người tạo) — bỏ qua`,
      );
      // Vẫn đánh dấu để cron sáng không xét lại vô ích.
      await this.prisma.task.update({
        where: { id: task.id },
        data: { content_win_pushed_at: new Date() },
      });
      return;
    }

    const month = this.currentMonth();
    const current = await this.prisma.content.findUnique({
      where: { id: contentId },
      select: { classification_id: true, won_at: true },
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.contentWarehouse.upsert({
        where: { content_id_month: { content_id: contentId, month } },
        create: { content_id: contentId, month },
        update: {},
      });
      await tx.content.update({
        where: { id: contentId },
        data: {
          // Nhãn "Win" chỉ set khi content chưa có nhãn — không đè phân loại thủ công.
          ...(current?.classification_id
            ? {}
            : { classification_id: contentWinClassificationId }),
          // Link thắng chỉ ghi lần đầu (won_at null) — lần sau giữ nguyên "trận thắng đầu tiên".
          ...(current?.won_at
            ? {}
            : {
                win_video_url: win.url || null,
                win_video_views: BigInt(win.views),
                win_video_platform: win.platform || null,
                won_at: new Date(),
              }),
        },
      });
      await tx.task.update({
        where: { id: task.id },
        data: { content_win_pushed_at: new Date() },
      });
    });
  }

  /**
   * id 1 row Content ở kho tổng cho content của task: content_id → dùng thẳng; team_content_id
   * → Content(source_team_content_id), tạo nếu chưa có; editor_content_id → tương tự, copy
   * title/body/script (KHÔNG copy code — unique toàn hệ thống); không gắn content → tạo mới cho
   * video thắng (dedupe win_video_url). null nếu không có cả assignee lẫn reviewer làm added_by.
   */
  private async resolveGlobalContentId(
    task: WinningTaskRow,
    win: WinningLink,
    contentWinClassificationId: string,
  ): Promise<string | null> {
    if (task.content_id) return task.content_id;

    if (task.team_content_id) {
      const existing = await this.prisma.content.findUnique({
        where: { source_team_content_id: task.team_content_id },
        select: { id: true },
      });
      if (existing) return existing.id;

      const tc = await this.prisma.teamContent.findUnique({
        where: { id: task.team_content_id },
        select: { brand_type: true, origin: true, added_by_id: true },
      });
      if (!tc) return null;

      const created = await this.prisma.content.create({
        data: {
          source_team_content_id: task.team_content_id,
          brand_type: tc.brand_type,
          classification_id: contentWinClassificationId,
          origin: tc.origin,
          added_by_id: task.assignee_id ?? tc.added_by_id,
        },
        select: { id: true },
      });
      return created.id;
    }

    if (task.editor_content_id) {
      const existing = await this.prisma.content.findUnique({
        where: { source_editor_content_id: task.editor_content_id },
        select: { id: true },
      });
      if (existing) return existing.id;

      const ec = await this.prisma.editorContent.findUnique({
        where: { id: task.editor_content_id },
        select: {
          brand_type: true,
          market: true,
          title: true,
          body: true,
          script: true,
          file_content_url: true,
          added_by_id: true,
          user_id: true,
        },
      });
      if (!ec) return null;

      const created = await this.prisma.content.create({
        data: {
          source_editor_content_id: task.editor_content_id,
          brand_type: ec.brand_type,
          market: ec.market,
          title: ec.title,
          body: ec.body,
          script: ec.script,
          file_content_url: ec.file_content_url,
          classification_id: contentWinClassificationId,
          added_by_id: task.assignee_id ?? ec.added_by_id ?? ec.user_id,
        },
        select: { id: true },
      });
      return created.id;
    }

    // Task sáng tạo không gắn content — content chính là video thắng. Dedupe URL để chạy lại
    // (hoặc content_win_pushed_at bị xoá tay) không tạo trùng.
    if (win.url) {
      const existing = await this.prisma.content.findFirst({
        where: { win_video_url: win.url },
        select: { id: true },
      });
      if (existing) return existing.id;
    }

    const addedById = task.assignee_id ?? task.reviewed_by_id;
    if (!addedById) return null;

    const created = await this.prisma.content.create({
      data: {
        brand_type: (task.brand_type ?? task.team?.brand_type) as any,
        market: task.team?.market,
        content_line_id: task.content_line_id ?? undefined,
        title: this.buildSyntheticTitle(task),
        classification_id: contentWinClassificationId,
        added_by_id: addedById,
      },
      select: { id: true },
    });
    return created.id;
  }

  private buildSyntheticTitle(task: WinningTaskRow): string {
    // Kho tổng list hiển thị theo title — cho 1 nhãn dễ nhận ra thay vì để trống.
    const line = task.content_line?.name ? ` · ${task.content_line.name}` : "";
    return `Content Win${line}`;
  }

  private async getContentWinClassificationId(): Promise<string> {
    const existing = await this.prisma.contentClassification.findUnique({
      where: { name: CONTENT_WIN_CLASSIFICATION_NAME },
      select: { id: true },
    });
    if (existing) return existing.id;

    try {
      const created = await this.prisma.contentClassification.create({
        data: { name: CONTENT_WIN_CLASSIFICATION_NAME },
        select: { id: true },
      });
      return created.id;
    } catch (err: any) {
      // Race: 2 luồng cùng tạo — P2002 unique(name), đọc lại.
      if (err?.code === "P2002") {
        const again = await this.prisma.contentClassification.findUnique({
          where: { name: CONTENT_WIN_CLASSIFICATION_NAME },
          select: { id: true },
        });
        if (again) return again.id;
      }
      throw err;
    }
  }
}
