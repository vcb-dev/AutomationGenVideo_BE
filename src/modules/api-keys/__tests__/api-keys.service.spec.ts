import { UnauthorizedException } from "@nestjs/common";
import type { PrismaService } from "../../../common/prisma/prisma.service";
import { ApiKeysService } from "../api-keys.service";
import {
  API_KEY_PREFIX,
  apiKeyPrefixOf,
  extractApiKey,
  generateRawApiKey,
  hashApiKey,
  verifyApiKey,
} from "../api-key.util";

// ── api-key.util ────────────────────────────────────────────────────────────────

describe("api-key.util", () => {
  it("generateRawApiKey: tiền tố agv_ + 48 hex, mỗi lần một khác", () => {
    const a = generateRawApiKey();
    const b = generateRawApiKey();
    expect(a.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(a).toHaveLength(API_KEY_PREFIX.length + 48);
    expect(a.slice(API_KEY_PREFIX.length)).toMatch(/^[0-9a-f]{48}$/);
    expect(a).not.toEqual(b);
  });

  it("hashApiKey: sha256 hex ổn định, khác nhau theo input", () => {
    expect(hashApiKey("agv_abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKey("agv_abc")).toEqual(hashApiKey("agv_abc"));
    expect(hashApiKey("agv_abc")).not.toEqual(hashApiKey("agv_abd"));
  });

  it("apiKeyPrefixOf: 12 ký tự đầu của key thô", () => {
    const raw = generateRawApiKey();
    expect(apiKeyPrefixOf(raw)).toEqual(raw.slice(0, 12));
    expect(apiKeyPrefixOf(raw).startsWith(API_KEY_PREFIX)).toBe(true);
  });

  it("extractApiKey: đọc từ header X-API-Key và từ Authorization: Bearer agv_...", () => {
    const raw = generateRawApiKey();
    expect(extractApiKey({ headers: { "x-api-key": raw } } as any)).toEqual(raw);
    expect(extractApiKey({ headers: { authorization: `Bearer ${raw}` } } as any)).toEqual(raw);
  });

  it("extractApiKey: null khi không có key hoặc token không phải dạng agv_", () => {
    expect(extractApiKey({ headers: {} } as any)).toBeNull();
    expect(extractApiKey({ headers: { authorization: "Bearer eyJhbGciOi.something" } } as any)).toBeNull();
    expect(extractApiKey({ headers: { "x-api-key": "not-a-key" } } as any)).toBeNull();
  });
});

// ── verifyApiKey ───────────────────────────────────────────────────────────────

function buildPrisma(apiKeyFindUnique: jest.Mock): PrismaService {
  return { apiKey: { findUnique: apiKeyFindUnique } } as unknown as PrismaService;
}

const ACTIVE_SERVICE_USER = {
  id: "svc-1",
  email: "svc-x@apikey.internal",
  full_name: "API Key: X",
  roles: ["ADMIN"],
  manager_id: null,
  is_active: true,
  team: null,
  created_at: new Date(),
  updated_at: new Date(),
};

function validRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "key-1",
    name: "OMS",
    is_active: true,
    revoked_at: null,
    expires_at: null,
    service_user: ACTIVE_SERVICE_USER,
    ...overrides,
  };
}

describe("verifyApiKey", () => {
  it("key hợp lệ → trả apiKeyId + name + service user thật", async () => {
    const prisma = buildPrisma(jest.fn().mockResolvedValue(validRecord()));
    const out = await verifyApiKey(prisma, "agv_deadbeef");
    expect(out).toEqual({ apiKeyId: "key-1", name: "OMS", serviceUser: ACTIVE_SERVICE_USER });
  });

  it("không tìm thấy → 401", async () => {
    const prisma = buildPrisma(jest.fn().mockResolvedValue(null));
    await expect(verifyApiKey(prisma, "agv_x")).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("đã thu hồi (revoked_at != null) → 401", async () => {
    const prisma = buildPrisma(jest.fn().mockResolvedValue(validRecord({ revoked_at: new Date() })));
    await expect(verifyApiKey(prisma, "agv_x")).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("is_active = false → 401", async () => {
    const prisma = buildPrisma(jest.fn().mockResolvedValue(validRecord({ is_active: false })));
    await expect(verifyApiKey(prisma, "agv_x")).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("expires_at trong quá khứ → 401", async () => {
    const past = new Date(Date.now() - 1000);
    const prisma = buildPrisma(jest.fn().mockResolvedValue(validRecord({ expires_at: past })));
    await expect(verifyApiKey(prisma, "agv_x")).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("tài khoản dịch vụ bị vô hiệu hoá → 401", async () => {
    const prisma = buildPrisma(
      jest.fn().mockResolvedValue(validRecord({ service_user: { ...ACTIVE_SERVICE_USER, is_active: false } })),
    );
    await expect(verifyApiKey(prisma, "agv_x")).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("tra cứu bằng sha256(key thô), không phải key thô", async () => {
    const findUnique = jest.fn().mockResolvedValue(validRecord());
    await verifyApiKey(buildPrisma(findUnique), "agv_raw-value");
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key_hash: hashApiKey("agv_raw-value") } }),
    );
  });
});

// ── ApiKeysService ─────────────────────────────────────────────────────────────

function buildServicePrisma() {
  const tx = {
    user: { create: jest.fn().mockResolvedValue({ id: "svc-new" }) },
    apiKey: { create: jest.fn((args) => Promise.resolve({ id: "key-new", ...args.select })) },
  };
  const prisma = {
    $transaction: jest.fn((arg: any) =>
      typeof arg === "function" ? arg(tx) : Promise.all(arg),
    ),
    apiKey: {
      create: tx.apiKey.create,
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      update: jest.fn((args) => Promise.resolve({ id: args.where.id, ...args.data })),
      delete: jest.fn().mockResolvedValue({ id: "key-1" }),
    },
    user: { delete: jest.fn().mockResolvedValue({ id: "svc-1" }) },
  };
  return { prisma: prisma as unknown as PrismaService, tx };
}

describe("ApiKeysService", () => {
  it("create: sinh key thô, tạo service user role [ADMIN] mặc định, chỉ trả key 1 lần", async () => {
    const { prisma, tx } = buildServicePrisma();
    const service = new ApiKeysService(prisma);

    const res: any = await service.create({ name: "OMS" } as any, "admin-1");

    expect(res.key.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(tx.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ roles: ["ADMIN"] }) }),
    );
    const apiKeyArgs = tx.apiKey.create.mock.calls[0][0];
    expect(apiKeyArgs.data.key_hash).toEqual(hashApiKey(res.key));
    expect(apiKeyArgs.data.prefix).toEqual(res.key.slice(0, 12));
    expect(apiKeyArgs.data.created_by).toEqual("admin-1");
    // select không được lộ key_hash ra ngoài
    expect(apiKeyArgs.select.key_hash).toBeUndefined();
  });

  it("create: tôn trọng roles truyền vào và expiresAt", async () => {
    const { prisma, tx } = buildServicePrisma();
    const service = new ApiKeysService(prisma);

    await service.create({ name: "Lark", roles: ["MEMBER"], expiresAt: "2999-01-01T00:00:00.000Z" } as any, "admin-1");

    expect(tx.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ roles: ["MEMBER"] }) }),
    );
    expect(tx.apiKey.create.mock.calls[0][0].data.expires_at).toEqual(new Date("2999-01-01T00:00:00.000Z"));
  });

  it("list: không select key_hash", async () => {
    const { prisma } = buildServicePrisma();
    await new ApiKeysService(prisma).list();
    const select = (prisma.apiKey.findMany as jest.Mock).mock.calls[0][0].select;
    expect(select.key_hash).toBeUndefined();
    expect(select.id).toBe(true);
  });

  it("revoke: set is_active=false + revoked_at", async () => {
    const { prisma } = buildServicePrisma();
    (prisma.apiKey.findUnique as jest.Mock).mockResolvedValue({ id: "key-1" });
    const out: any = await new ApiKeysService(prisma).revoke("key-1");
    expect(out.is_active).toBe(false);
    expect(out.revoked_at).toBeInstanceOf(Date);
  });

  it("remove: xoá row key rồi xoá tài khoản dịch vụ", async () => {
    const { prisma } = buildServicePrisma();
    (prisma.apiKey.findUnique as jest.Mock).mockResolvedValue({ id: "key-1", service_user_id: "svc-1" });

    const out = await new ApiKeysService(prisma).remove("key-1");

    expect(prisma.apiKey.delete).toHaveBeenCalledWith({ where: { id: "key-1" } });
    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: "svc-1" } });
    expect(out).toEqual({ id: "key-1", deleted: true });
  });
});
