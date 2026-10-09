import { Test, TestingModule } from "@nestjs/testing";
import { ChannelsService } from "../channels.service";
import { PrismaService } from "../../../common/prisma/prisma.service";
import { UserRole } from "@prisma/client";

describe("ChannelsService", () => {
  let service: ChannelsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      channel: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "ch-1",
            name: "Channel A",
            owner_id: "user-1",
            platform: "tiktok",
            status: "đang hoạt động",
          },
        ]),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      trackedChannel: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "tc-1",
            user_id: "user-1",
            platform: "FACEBOOK",
            username: "page_1",
            display_name: "Page One",
            is_active: true,
            created_at: new Date(),
            updated_at: new Date(),
          },
        ]),
      },
      team: {
        findUnique: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChannelsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<ChannelsService>(ChannelsService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("findMine", () => {
    it("should query channels matching owner_id, email, owner name and tracked channels", async () => {
      const user = {
        id: "user-1",
        email: "test@example.com",
        full_name: "Test User",
        roles: [UserRole.MEMBER],
        team: "Team A",
      };

      const result = await service.findMine(user);

      expect(prisma.channel.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { owner_id: "user-1" },
              { email: { equals: "test@example.com", mode: "insensitive" } },
              { owner: { equals: "Test User", mode: "insensitive" } },
            ],
          },
        })
      );
      expect(prisma.trackedChannel.findMany).toHaveBeenCalledWith({
        where: { user_id: "user-1", is_active: true },
        orderBy: { created_at: "desc" },
      });
      expect(result.length).toBe(2);
      expect(result[0].name).toBe("Channel A");
      expect(result[1].name).toBe("Page One");
    });

    it("should return all channels for ADMIN if no personal channel is assigned", async () => {
      prisma.channel.findMany
        .mockResolvedValueOnce([]) // First findMany returns empty
        .mockResolvedValueOnce([
          { id: "all-1", name: "System Channel 1" },
          { id: "all-2", name: "System Channel 2" },
        ]);
      prisma.trackedChannel.findMany.mockResolvedValueOnce([]);

      const user = {
        id: "admin-1",
        email: "admin@example.com",
        full_name: "Admin User",
        roles: [UserRole.ADMIN],
        team: null,
      };

      const result = await service.findMine(user);
      expect(result.length).toBe(2);
      expect(result[0].name).toBe("System Channel 1");
    });
  });

  describe("findAll", () => {
    it("should return all channels for ADMIN without team restriction", async () => {
      const user = {
        roles: [UserRole.ADMIN],
        team: "Admin Team",
      };

      await service.findAll(user);

      expect(prisma.channel.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: undefined,
        })
      );
    });

    it("should filter by team for non-admin user with team", async () => {
      const user = {
        roles: [UserRole.MEMBER],
        team: "Media Team",
      };

      await service.findAll(user);

      expect(prisma.channel.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { channel_team: { name: { equals: "Media Team", mode: "insensitive" } } },
        })
      );
    });
  });

  /**
   * Tạo kênh: mặc định team/owner = người tạo; ADMIN/MANAGER được chọn team + người cầm kênh
   * (phải là thành viên team). owner/team_traffic (string cũ) phải khớp theo lựa chọn vì báo cáo
   * traffic đọc 2 field này.
   */
  describe("create", () => {
    const TEAM_ID = "11111111-1111-4111-8111-111111111111";
    const OWNER_ID = "22222222-2222-4222-8222-222222222222";

    beforeEach(() => {
      prisma.team.findFirst = jest.fn().mockResolvedValue({ id: "own-team-id" });
      prisma.team.findUnique = jest.fn().mockResolvedValue({ id: TEAM_ID, name: "Global - Mỹ" });
      prisma.teamMember = { findFirst: jest.fn().mockResolvedValue({ id: "tm-1" }) };
      prisma.user.findUnique = jest.fn().mockResolvedValue({ full_name: "Bùi Anh Tú" });
      prisma.channel.create = jest.fn().mockImplementation(({ data }) => data);
    });

    it("ADMIN chọn team + người cầm kênh → ghi đúng FK và field string", async () => {
      const admin = { id: "admin-1", roles: [UserRole.ADMIN], team: null, full_name: "Admin" };

      const data = await service.create(
        { name: "Kênh mới", platform: "tiktok", team_id: TEAM_ID, owner_id: OWNER_ID },
        admin,
      );

      expect(prisma.teamMember.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { team_id: TEAM_ID, user_id: OWNER_ID } }),
      );
      expect(data).toMatchObject({
        name: "Kênh mới",
        team_id: TEAM_ID,
        team_traffic: "Global - Mỹ",
        owner_id: OWNER_ID,
        owner: "Bùi Anh Tú",
      });
    });

    it("ADMIN chọn người cầm kênh không thuộc team → 403, không tạo kênh", async () => {
      prisma.teamMember.findFirst.mockResolvedValue(null);
      const admin = { id: "admin-1", roles: [UserRole.ADMIN], team: null, full_name: "Admin" };

      await expect(
        service.create({ name: "Kênh mới", team_id: TEAM_ID, owner_id: OWNER_ID }, admin),
      ).rejects.toThrow("Owner phải là thành viên trong team của kênh");
      expect(prisma.channel.create).not.toHaveBeenCalled();
    });

    it("ADMIN chọn team không tồn tại → 404", async () => {
      prisma.team.findUnique.mockResolvedValue(null);
      const admin = { id: "admin-1", roles: [UserRole.MANAGER], team: null, full_name: "Admin" };

      await expect(
        service.create({ name: "Kênh mới", team_id: TEAM_ID, owner_id: OWNER_ID }, admin),
      ).rejects.toThrow(`Team ${TEAM_ID} not found`);
      expect(prisma.channel.create).not.toHaveBeenCalled();
    });

    it("role khác ADMIN/MANAGER truyền team/owner → bị bỏ qua, gán theo người tạo", async () => {
      const leader = { id: "leader-1", roles: [UserRole.LEADER], team: "Media Team", full_name: "Leader A" };

      const data = await service.create(
        { name: "Kênh mới", team_id: TEAM_ID, owner_id: OWNER_ID },
        leader,
      );

      expect(prisma.team.findUnique).not.toHaveBeenCalled();
      expect(prisma.teamMember.findFirst).not.toHaveBeenCalled();
      expect(data).toMatchObject({
        team_id: "own-team-id",
        team_traffic: "Media Team",
        owner_id: "leader-1",
        owner: "Leader A",
      });
    });
  });
});
