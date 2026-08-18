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
});
