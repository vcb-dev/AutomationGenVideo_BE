import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ThreadsScraperController } from '../src/modules/threads-scraper/threads-scraper.controller';

describe('External Channels Roles & RBAC Guards (Phân quyền 4 Roles)', () => {
  let controller: ThreadsScraperController;
  let serviceMock: any;
  let readServiceMock: any;

  beforeEach(() => {
    serviceMock = {
      periodicRefresh: jest.fn().mockResolvedValue({}),
      batchScrape: jest.fn().mockResolvedValue({}),
      scrapeByUsername: jest.fn().mockResolvedValue({}),
      searchHotPosts: jest.fn().mockResolvedValue({}),
      toggle: jest.fn().mockResolvedValue(true),
      deleteProfile: jest.fn().mockResolvedValue({ deleted: true }),
    };

    readServiceMock = {
      listProfiles: jest.fn().mockResolvedValue([]),
      listAllPosts: jest.fn().mockResolvedValue([]),
      getProfileDetail: jest.fn().mockResolvedValue({}),
      getProfilePosts: jest.fn().mockResolvedValue([]),
    };

    controller = new ThreadsScraperController(serviceMock, readServiceMock);
  });

  describe('toggle is_tracked vs is_bookmarked', () => {
    it('cho phép MEMBER lưu bookmark (is_bookmarked)', async () => {
      const req = { user: { roles: [UserRole.MEMBER] } };
      await expect(
        controller.toggle('123', { field: 'is_bookmarked', value: true }, req),
      ).resolves.toBe(true);

      expect(serviceMock.toggle).toHaveBeenCalledWith(123n, 'is_bookmarked', true);
    });

    it('CHẶN MEMBER bật tắt kênh chú ý (is_tracked) với ForbiddenException', async () => {
      const req = { user: { roles: [UserRole.MEMBER] } };
      await expect(
        controller.toggle('123', { field: 'is_tracked', value: true }, req),
      ).rejects.toThrow(ForbiddenException);

      expect(serviceMock.toggle).not.toHaveBeenCalled();
    });

    it('cho phép LEADER bật tắt kênh chú ý (is_tracked)', async () => {
      const req = { user: { roles: [UserRole.LEADER] } };
      await expect(
        controller.toggle('123', { field: 'is_tracked', value: true }, req),
      ).resolves.toBe(true);

      expect(serviceMock.toggle).toHaveBeenCalledWith(123n, 'is_tracked', true);
    });

    it('cho phép MANAGER bật tắt kênh chú ý (is_tracked)', async () => {
      const req = { user: { roles: [UserRole.MANAGER] } };
      await expect(
        controller.toggle('123', { field: 'is_tracked', value: true }, req),
      ).resolves.toBe(true);

      expect(serviceMock.toggle).toHaveBeenCalledWith(123n, 'is_tracked', true);
    });

    it('cho phép ADMIN bật tắt kênh chú ý (is_tracked)', async () => {
      const req = { user: { roles: [UserRole.ADMIN] } };
      await expect(
        controller.toggle('123', { field: 'is_tracked', value: true }, req),
      ).resolves.toBe(true);

      expect(serviceMock.toggle).toHaveBeenCalledWith(123n, 'is_tracked', true);
    });
  });

  describe('Metadata Roles Decorator on Controller Endpoints', () => {
    it('syncAll gắn decorator Roles với đủ ADMIN, LEADER, MANAGER', () => {
      const roles = Reflect.getMetadata('roles', controller.syncAll);
      expect(roles).toEqual(expect.arrayContaining([UserRole.ADMIN, UserRole.LEADER, UserRole.MANAGER]));
      expect(roles).not.toContain(UserRole.MEMBER);
    });

    it('scrape gắn decorator Roles với đủ ADMIN, LEADER, MANAGER', () => {
      const roles = Reflect.getMetadata('roles', controller.scrape);
      expect(roles).toEqual(expect.arrayContaining([UserRole.ADMIN, UserRole.LEADER, UserRole.MANAGER]));
      expect(roles).not.toContain(UserRole.MEMBER);
    });

    it('batchScrape gắn decorator Roles với đủ ADMIN, LEADER, MANAGER', () => {
      const roles = Reflect.getMetadata('roles', controller.batchScrape);
      expect(roles).toEqual(expect.arrayContaining([UserRole.ADMIN, UserRole.LEADER, UserRole.MANAGER]));
      expect(roles).not.toContain(UserRole.MEMBER);
    });

    it('searchTop gắn decorator Roles với đủ ADMIN, LEADER, MANAGER', () => {
      const roles = Reflect.getMetadata('roles', controller.searchTop);
      expect(roles).toEqual(expect.arrayContaining([UserRole.ADMIN, UserRole.LEADER, UserRole.MANAGER]));
      expect(roles).not.toContain(UserRole.MEMBER);
    });

    it('delete gắn decorator Roles với đủ ADMIN, LEADER, MANAGER', () => {
      const roles = Reflect.getMetadata('roles', controller.delete);
      expect(roles).toEqual(expect.arrayContaining([UserRole.ADMIN, UserRole.LEADER, UserRole.MANAGER]));
      expect(roles).not.toContain(UserRole.MEMBER);
    });
  });
});
