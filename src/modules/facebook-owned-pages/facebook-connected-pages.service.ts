import { Injectable, Logger } from '@nestjs/common';
import { SocialPlatform } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../social-publishing/crypto/crypto.service';
import { FacebookAiClientService, type FetchedManagedPage } from './facebook-ai-client.service';
import { FacebookOwnedPagesService } from './facebook-owned-pages.service';

export interface ImportAllPagesResult {
  created: number;
  updated: number;
  newPageIds: string[];
  /** Page lấy thêm từ tài khoản kết nối ở Đăng bài MXH (không tính page token hệ thống đã kéo). */
  connectedPages: number;
  /** Tài khoản Facebook có page đang bật ở Đăng bài MXH nhưng không lấy được page nào. */
  failedAccounts: string[];
}

interface ConnectedAccountGroup {
  name: string;
  /** Token đã mã hoá của các lượt kết nối cùng một tài khoản Facebook, mới nhất trước. */
  tokens: string[];
  pageIds: Set<string>;
}

/**
 * Kênh nội bộ Facebook = page của token hệ thống + page mọi người đã kết nối ở Đăng bài MXH.
 *
 * Trước đây chỉ có nửa đầu: nút "Đồng bộ từ Facebook" hỏi `/me/accounts` bằng MỘT token hệ thống,
 * page của người khác kết nối ở Đăng bài MXH → Kênh (bảng social_accounts, token riêng từng người)
 * không bao giờ sang được bảng Kênh nội bộ. Instagram/Threads nội bộ đã lấy tài khoản kết nối làm
 * nguồn sự thật từ lâu — đây là phần Facebook còn thiếu.
 *
 * Token page trong bảng Kênh nội bộ phải do AI mã hoá (Fernet, xem FacebookAiClientService), nên
 * không chép token page từ social_accounts sang được. Thay vào đó lấy token tài khoản Facebook gốc
 * của người kết nối, gọi lại đúng endpoint managed-pages của AI rồi CHỈ giữ các page người đó
 * đang bật ở Đăng bài MXH. Chỉ gọi AI cho tài khoản có page mà token hệ thống chưa kéo về, nên
 * lần đồng bộ thường gần như không tốn thêm lượt gọi.
 */
@Injectable()
export class FacebookConnectedPagesService {
  private readonly logger = new Logger(FacebookConnectedPagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly aiClient: FacebookAiClientService,
    private readonly ownedPages: FacebookOwnedPagesService,
  ) {}

  async importAll(userAccessToken?: string): Promise<ImportAllPagesResult> {
    let system = { created: 0, updated: 0, newPageIds: [] as string[], pageIds: [] as string[] };
    let systemError: unknown = null;
    try {
      system = await this.ownedPages.importManagedPages(userAccessToken);
    } catch (err) {
      // Token hệ thống hỏng không được chặn page của người khác — vẫn gộp tiếp, cuối cùng mới báo.
      systemError = err;
      this.logger.error(`[IMPORT] Token hệ thống lỗi: ${(err as Error)?.message}`);
    }

    const connected = await this.fetchConnectedAccountPages(new Set(system.pageIds));
    const merged = await this.ownedPages.upsertManagedPages(connected.pages);
    if (systemError && merged.pageIds.length === 0) throw systemError;

    if (connected.failedAccounts.length) {
      this.logger.warn(`[IMPORT] Không lấy được page từ: ${connected.failedAccounts.join(', ')}`);
    }
    return {
      created: system.created + merged.created,
      updated: system.updated + merged.updated,
      newPageIds: [...system.newPageIds, ...merged.newPageIds],
      connectedPages: merged.pageIds.length,
      failedAccounts: connected.failedAccounts,
    };
  }

  /** Page đang bật ở Đăng bài MXH mà `seenPageIds` (token hệ thống) chưa có, kèm token AI mã hoá. */
  async fetchConnectedAccountPages(seenPageIds: Set<string>): Promise<{ pages: FetchedManagedPage[]; failedAccounts: string[] }> {
    const pages: FetchedManagedPage[] = [];
    const failedAccounts: string[] = [];
    const taken = new Set(seenPageIds);

    for (const group of await this.loadConnectedAccounts()) {
      const wanted = [...group.pageIds].filter((id) => !taken.has(id));
      if (!wanted.length) continue;

      const found = await this.fetchPagesOfAccount(group, new Set(wanted));
      if (!found.length) {
        failedAccounts.push(group.name);
        continue;
      }
      for (const page of found) {
        if (taken.has(page.page_id)) continue;
        taken.add(page.page_id);
        pages.push(page);
      }
    }
    return { pages, failedAccounts };
  }

  /** Thử lần lượt các lượt kết nối của một tài khoản (mới nhất trước) tới khi lấy được page. */
  private async fetchPagesOfAccount(group: ConnectedAccountGroup, wanted: Set<string>): Promise<FetchedManagedPage[]> {
    for (const tokenEnc of group.tokens) {
      try {
        const { pages } = await this.aiClient.fetchManagedPages(this.crypto.decrypt(tokenEnc));
        const found = (pages ?? []).filter((p) => wanted.has(p.page_id));
        if (found.length) return found;
      } catch (err) {
        this.logger.warn(`[IMPORT] Tài khoản ${group.name}: ${(err as Error)?.message}`);
      }
    }
    return [];
  }

  /**
   * Gom page Facebook đang bật ở Đăng bài MXH theo tài khoản Facebook gốc. Một tài khoản Facebook
   * có thể được nhiều người dùng VCBI kết nối (mỗi người một dòng gốc) — gộp lại để chỉ gọi AI
   * một lần cho mỗi tài khoản Facebook.
   */
  private async loadConnectedAccounts(): Promise<ConnectedAccountGroup[]> {
    const pageRows = await this.prisma.socialAccount.findMany({
      where: { platform: SocialPlatform.FACEBOOK, is_active: true, parent_id: { not: null } },
      select: { platform_id: true, parent_id: true, extra_data: true },
    });
    const pagesByParent = new Map<string, Set<string>>();
    for (const row of pageRows) {
      const pageId = facebookPageIdOf(row);
      if (!pageId || !row.parent_id) continue;
      if (!pagesByParent.has(row.parent_id)) pagesByParent.set(row.parent_id, new Set());
      pagesByParent.get(row.parent_id)!.add(pageId);
    }
    if (!pagesByParent.size) return [];

    const roots = await this.prisma.socialAccount.findMany({
      where: { id: { in: [...pagesByParent.keys()] }, is_active: true },
      select: { id: true, platform_id: true, name: true, access_token_enc: true },
      orderBy: { updated_at: 'desc' },
    });
    const groups = new Map<string, ConnectedAccountGroup>();
    for (const root of roots) {
      if (!root.access_token_enc) continue;
      const group = groups.get(root.platform_id) ?? { name: root.name || root.platform_id, tokens: [], pageIds: new Set<string>() };
      group.tokens.push(root.access_token_enc);
      pagesByParent.get(root.id)!.forEach((id) => group.pageIds.add(id));
      groups.set(root.platform_id, group);
    }
    return [...groups.values()];
  }
}

/** Dòng page Facebook ở social_accounts: `platform_id = "page_<id>"`, `extra_data.pageId = "<id>"`. */
export function facebookPageIdOf(row: { platform_id: string; extra_data: unknown }): string {
  const fromExtra = (row.extra_data as { pageId?: unknown } | null)?.pageId;
  if (typeof fromExtra === 'string' && fromExtra) return fromExtra;
  return row.platform_id.startsWith('page_') ? row.platform_id.slice('page_'.length) : '';
}

/** Câu báo kết quả cho nút "Đồng bộ từ Facebook". */
export function importSummaryMessage(result: ImportAllPagesResult): string {
  let message = `Đã đồng bộ xong danh sách Page (Thêm mới: ${result.created}, Cập nhật: ${result.updated})`;
  if (result.connectedPages) message += ` — gồm ${result.connectedPages} page từ tài khoản kết nối ở Đăng bài MXH`;
  if (result.failedAccounts.length) {
    message += `. Không lấy được page của: ${result.failedAccounts.join(', ')} — nhờ họ kết nối lại Facebook ở Đăng bài MXH → Kênh`;
  }
  return message;
}
