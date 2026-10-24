import { Injectable } from '@nestjs/common';
import { isMediaLeaderOrAdminUser } from '../../../common/guards/mems-media-leader.guard';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { classifyReturnAlerts, EXPIRING_SOON_MINUTES, HOLDING_STATUSES } from '../../../utils/mems/return-alerts.util';
import { RequestViewer } from '../approvals/approvals.service';

@Injectable()
export class ReturnAlertsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Thành viên chỉ thấy phiếu của mình; quản lý kho Media và admin thấy cả kho. */
  async list(viewer: RequestViewer, now: Date = new Date()) {
    const ownerScope = isMediaLeaderOrAdminUser(viewer) ? {} : { owner_id: viewer.id };
    const requests = await this.prisma.memsBorrowRequest.findMany({
      where: {
        ...ownerScope,
        status: { in: HOLDING_STATUSES },
        to_time: { lte: new Date(now.getTime() + EXPIRING_SOON_MINUTES * 60_000) },
      },
      select: {
        id: true,
        request_code: true,
        owner_id: true,
        project: true,
        place: true,
        from_time: true,
        to_time: true,
        status: true,
      },
      orderBy: { to_time: 'asc' },
    });
    const owners = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(requests.map((r) => r.owner_id))] } },
      select: { id: true, full_name: true },
    });
    const nameById = new Map(owners.map((u) => [u.id, u.full_name]));
    return classifyReturnAlerts(
      requests.map((r) => ({ ...r, owner_name: nameById.get(r.owner_id) ?? '—' })),
      now,
    );
  }
}
