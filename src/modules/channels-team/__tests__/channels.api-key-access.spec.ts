import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { UserRole } from "@prisma/client";
import { JwtOrApiKeyGuard } from "../../api-keys/guards/jwt-or-api-key.guard";
import { ChannelsController } from "../channels.controller";
import { ChannelsService } from "../channels.service";
import type { PrismaService } from "../../../common/prisma/prisma.service";

const RAW_KEY = "agv_" + "a".repeat(48);

const SERVICE_USER = {
  id: "svc-1",
  email: "svc-channels@apikey.internal",
  full_name: "API Key: Channels",
  roles: [UserRole.ADMIN],
  manager_id: null,
  is_active: true,
  team: null,
  created_at: new Date(),
  updated_at: new Date(),
};

function buildPrisma(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    apiKey: {
      findUnique: jest.fn(async () => ({
        id: "key-1",
        name: "channels-reader",
        is_active: true,
        revoked_at: null,
        expires_at: null,
        service_user: SERVICE_USER,
        ...overrides,
      })),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
  } as any;
}

function buildCtx(handler: unknown, method: string) {
  const req: any = { headers: { "x-api-key": RAW_KEY }, method, socket: {} };
  return {
    req,
    ctx: {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => handler,
      getClass: () => ChannelsController,
    } as any,
  };
}

describe("API key trên ChannelsController", () => {
  it("GET /channels: API key hợp lệ đi qua guard, req.user là tài khoản dịch vụ", async () => {
    const prisma = buildPrisma();
    const { ctx, req } = buildCtx(ChannelsController.prototype.findAll, "GET");

    await expect(
      new JwtOrApiKeyGuard(new Reflector(), prisma).canActivate(ctx),
    ).resolves.toBe(true);
    expect(req.user).toEqual(SERVICE_USER);
    expect(req.apiKey).toEqual({ id: "key-1", name: "channels-reader" });
  });

  it("GET /channels/:id cũng mở cho API key", async () => {
    const prisma = buildPrisma();
    const { ctx } = buildCtx(ChannelsController.prototype.findOne, "GET");

    await expect(
      new JwtOrApiKeyGuard(new Reflector(), prisma).canActivate(ctx),
    ).resolves.toBe(true);
  });

  it("POST /channels/scraper-lookup: POST nhưng thuần đọc nên vẫn cho API key", async () => {
    const prisma = buildPrisma();
    const { ctx } = buildCtx(ChannelsController.prototype.scraperLookup, "POST");

    await expect(
      new JwtOrApiKeyGuard(new Reflector(), prisma).canActivate(ctx),
    ).resolves.toBe(true);
  });

  it.each([
    ["POST /channels", ChannelsController.prototype.create, "POST"],
    ["PATCH /channels/:id", ChannelsController.prototype.update, "PATCH"],
    ["DELETE /channels/:id", ChannelsController.prototype.remove, "DELETE"],
    ["POST /channels/import-from-meta", ChannelsController.prototype.importFromMeta, "POST"],
  ])("%s: API key bị chặn 403, không ghi được dữ liệu", async (_label, handler, method) => {
    const prisma = buildPrisma();
    const { ctx, req } = buildCtx(handler, method as string);

    await expect(
      new JwtOrApiKeyGuard(new Reflector(), prisma).canActivate(ctx),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(req.user).toBeUndefined();
  });

  it("key bị thu hồi: 401 trước khi xét quyền đọc/ghi", async () => {
    const prisma = buildPrisma({ revoked_at: new Date() });
    const { ctx } = buildCtx(ChannelsController.prototype.findAll, "GET");

    await expect(
      new JwtOrApiKeyGuard(new Reflector(), prisma).canActivate(ctx),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe("ChannelsService.findOne với tài khoản dịch vụ (ADMIN)", () => {
  const channel = {
    id: "ch-1",
    name: "Channel A",
    owner_id: "user-1",
    channel_team: { id: "team-1", name: "Team A" },
  };

  function buildService() {
    const prisma = {
      channel: { findUnique: jest.fn(async () => channel) },
    } as unknown as PrismaService;
    return new ChannelsService(prisma);
  }

  it("ADMIN (team = null) đọc được kênh của mọi team", async () => {
    await expect(
      buildService().findOne("ch-1", { roles: [UserRole.ADMIN], team: null }),
    ).resolves.toEqual(channel);
  });

  it("MEMBER khác team vẫn bị 403", async () => {
    await expect(
      buildService().findOne("ch-1", { roles: [UserRole.MEMBER], team: "Team B" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
