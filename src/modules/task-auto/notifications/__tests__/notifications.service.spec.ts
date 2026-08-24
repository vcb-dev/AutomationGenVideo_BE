import { NotificationsService } from '../notifications.service';

/**
 * broadcastToActiveUsers — dùng cho thông báo không thuộc về riêng user nào
 * (vd Growth Alert của scraper: kênh dùng chung toàn hệ thống, không có bảng
 * "user nào theo dõi kênh nào"). Quyết định sản phẩm: gửi cho TẤT CẢ user
 * đang active, không giới hạn role.
 */
describe('NotificationsService.broadcastToActiveUsers', () => {
  function build(activeUserIds: string[]) {
    const notificationRows: any[] = [];
    const prisma: any = {
      user: {
        findMany: jest.fn(async ({ where }: any) => {
          expect(where).toEqual({ is_active: true });
          return activeUserIds.map((id) => ({ id }));
        }),
      },
      notification: {
        createMany: jest.fn(async ({ data }: any) => { notificationRows.push(...data); return { count: data.length }; }),
      },
    };
    const push: any = { sendToUser: jest.fn(async () => {}) };
    const service = new NotificationsService(prisma, push);
    return { service, prisma, push, notificationRows };
  }

  afterEach(() => jest.clearAllMocks());

  it('chỉ truy vấn user có is_active=true (không giới hạn role)', async () => {
    const { service, prisma } = build(['u1', 'u2']);
    await service.broadcastToActiveUsers('GROWTH_ALERT', 'Title', 'Body');
    expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
  });

  it('tạo 1 Notification row cho mỗi user active, đúng type/title/body/meta', async () => {
    const { service, notificationRows } = build(['u1', 'u2', 'u3']);
    await service.broadcastToActiveUsers('GROWTH_ALERT', 'Kênh X tăng trưởng', 'Followers +25%', { platform: 'tiktok' });

    expect(notificationRows).toHaveLength(3);
    expect(notificationRows.map((r) => r.user_id).sort()).toEqual(['u1', 'u2', 'u3']);
    for (const row of notificationRows) {
      expect(row.type).toBe('GROWTH_ALERT');
      expect(row.title).toBe('Kênh X tăng trưởng');
      expect(row.body).toBe('Followers +25%');
      expect(row.meta).toEqual({ platform: 'tiktok' });
    }
  });

  it('gọi push.sendToUser cho từng user active', async () => {
    const { service, push } = build(['u1', 'u2']);
    await service.broadcastToActiveUsers('GROWTH_ALERT', 'Title', 'Body');

    expect(push.sendToUser).toHaveBeenCalledTimes(2);
    expect(push.sendToUser).toHaveBeenCalledWith('u1', { title: 'Title', body: 'Body' });
    expect(push.sendToUser).toHaveBeenCalledWith('u2', { title: 'Title', body: 'Body' });
  });

  it('không tạo Notification/push nào khi không có user active', async () => {
    const { service, prisma, push } = build([]);
    await service.broadcastToActiveUsers('GROWTH_ALERT', 'Title', 'Body');

    expect(prisma.notification.createMany).not.toHaveBeenCalled();
    expect(push.sendToUser).not.toHaveBeenCalled();
  });

  it('1 push thất bại không làm hỏng broadcast cho các user còn lại', async () => {
    const { service, push } = build(['u1', 'u2']);
    push.sendToUser.mockImplementationOnce(async () => { throw new Error('push down'); });

    await expect(service.broadcastToActiveUsers('GROWTH_ALERT', 'Title', 'Body')).resolves.toBeUndefined();
  });
});
