import { Controller, ForbiddenException, Logger, Post, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { InstagramOwnedAccountsService } from './instagram-owned-accounts.service';

// Đồng bộ là thao tác nặng (mỗi video một lượt hỏi Graph API) nên siết quyền như các thao tác
// quản lý kênh khác.
function assertCanSync(req: any): void {
  const roles: string[] = req.user?.roles ?? [];
  if (!roles.includes(UserRole.ADMIN) && !roles.includes(UserRole.LEADER)) {
    throw new ForbiddenException('Chỉ leader/admin được đồng bộ Instagram');
  }
}

@UseGuards(JwtAuthGuard)
@Controller('instagram-owned')
export class InstagramOwnedAccountsController {
  private readonly logger = new Logger(InstagramOwnedAccountsController.name);

  constructor(private readonly service: InstagramOwnedAccountsService) {}

  /** Quét lại 106 page tìm tài khoản Instagram Business gắn kèm. */
  @Post('import')
  async import(@Req() req: any) {
    assertCanSync(req);
    return this.service.importOwnedAccounts();
  }

  /** Import rồi kéo bài mới. Chạy nền: 14 tài khoản × 25 bài vượt xa thời gian chờ một request. */
  @Post('sync')
  async sync(@Req() req: any) {
    assertCanSync(req);

    this.service.syncAllOwnedAccounts().then(
      (r) => this.logger.log(`[IG-SYNC] ${r.accounts} tài khoản: +${r.created} bài mới, ~${r.updated} cập nhật`),
      (err) => this.logger.error(`[IG-SYNC] thất bại: ${err.message}`),
    );

    return {
      status: 'ok',
      message: 'Đã bắt đầu đồng bộ Instagram nội bộ. Theo dõi log [IG-SYNC] để biết kết quả.',
    };
  }
}
