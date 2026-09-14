import { ForbiddenException, HttpException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { InstagramScraperController } from '../instagram-scraper.controller';
import {
  InstagramScraperService,
  MANAGED_TOGGLE_FIELDS,
  TOGGLE_FIELDS,
} from '../instagram-scraper.service';

/**
 * Đánh dấu một profile Instagram là kênh nội bộ.
 *
 * Trang Tổng quan kênh nội bộ lọc `WHERE p.is_owned = true`, và trong DB không có profile
 * Instagram nào bật cờ đó — 56 profile đều được cào về như kênh đối thủ. Hệ quả: trang chỉ
 * hiện Facebook, Instagram biến mất hoàn toàn kể cả khi đã có 1.470 reels trong kho.
 *
 * Threads đã có sẵn nút bật/tắt (POST /scraper/threads/owned/toggle-owned), Instagram thì
 * endpoint toggle chỉ nhận `is_bookmarked` và `is_tracked`. Nay nhận thêm `is_owned`.
 *
 * Quyền: bật nhầm một kênh đối thủ thành kênh công ty là số liệu công ty sai theo, nên cờ
 * này phải cùng mức quyền với `is_tracked` — leader/admin. Riêng `is_bookmarked` là ghim cá
 * nhân, ai cũng được.
 */
describe('Toggle kênh nội bộ cho Instagram', () => {
  const buildController = () => {
    const toggleProfile = jest.fn().mockResolvedValue(true);
    const service = { toggleProfile } as unknown as InstagramScraperService;
    const controller = new InstagramScraperController(service, {} as never);
    return { controller, toggleProfile };
  };

  const asUser = (...roles: UserRole[]) => ({ user: { roles } });

  it('is_owned nằm trong danh sách cờ bật/tắt được', () => {
    expect(TOGGLE_FIELDS).toContain('is_owned');
  });

  it('leader bật được cờ is_owned', async () => {
    const { controller, toggleProfile } = buildController();

    const res = await controller.toggle('7', { field: 'is_owned' }, asUser(UserRole.LEADER));

    expect(toggleProfile).toHaveBeenCalledWith(BigInt(7), 'is_owned');
    expect(res).toEqual({ status: 'ok', is_owned: true });
  });

  it('admin cũng bật được', async () => {
    const { controller, toggleProfile } = buildController();

    await controller.toggle('7', { field: 'is_owned' }, asUser(UserRole.ADMIN));

    expect(toggleProfile).toHaveBeenCalledWith(BigInt(7), 'is_owned');
  });

  it('người thường KHÔNG được bật — số liệu công ty phụ thuộc vào cờ này', async () => {
    const { controller, toggleProfile } = buildController();

    await expect(
      controller.toggle('7', { field: 'is_owned' }, asUser(UserRole.MEMBER)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(toggleProfile).not.toHaveBeenCalled();
  });

  it('ghim cá nhân (is_bookmarked) thì ai cũng bật được, không đụng quyền', async () => {
    const { controller, toggleProfile } = buildController();

    await controller.toggle('7', { field: 'is_bookmarked' }, asUser(UserRole.MEMBER));

    expect(toggleProfile).toHaveBeenCalledWith(BigInt(7), 'is_bookmarked');
    expect(MANAGED_TOGGLE_FIELDS).not.toContain('is_bookmarked');
  });

  it('is_tracked giữ nguyên mức quyền cũ', async () => {
    const { controller } = buildController();

    await expect(
      controller.toggle('7', { field: 'is_tracked' }, asUser(UserRole.MEMBER)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each([undefined, 'is_active', 'is_admin', 'id'])('từ chối field lạ: %s', async (field) => {
    const { controller, toggleProfile } = buildController();

    await expect(
      controller.toggle('7', { field: field as never }, asUser(UserRole.ADMIN)),
    ).rejects.toBeInstanceOf(HttpException);
    expect(toggleProfile).not.toHaveBeenCalled();
  });
});
