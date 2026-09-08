import { UnauthorizedException } from "@nestjs/common";
import { createHash, randomBytes } from "crypto";
import type { Request } from "express";
import { PrismaService } from "../../common/prisma/prisma.service";

/** Header hệ thống ngoài dùng để đính API key — cùng quy ước với chiều BE gọi OMS. */
export const API_KEY_HEADER = "x-api-key";

/** Tiền tố nhận diện API key của hệ thống này. */
export const API_KEY_PREFIX = "agv_";

/** Số byte ngẫu nhiên cho phần thân key (48 hex ký tự). */
const KEY_RANDOM_BYTES = 24;

/** Độ dài `prefix` lưu xuống DB để đối chiếu trong danh sách ("agv_" + 8 hex). */
const STORED_PREFIX_LEN = API_KEY_PREFIX.length + 8;

/** Sinh key thô mới: `agv_` + 48 hex. Chỉ trả về cho người tạo đúng 1 lần. */
export function generateRawApiKey(): string {
  return API_KEY_PREFIX + randomBytes(KEY_RANDOM_BYTES).toString("hex");
}

/** SHA-256 hex của key thô — bản duy nhất được lưu xuống DB. */
export function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** 12 ký tự đầu của key thô, an toàn để hiển thị. */
export function apiKeyPrefixOf(raw: string): string {
  return raw.slice(0, STORED_PREFIX_LEN);
}

function looksLikeApiKey(value: string | undefined): value is string {
  return (
    typeof value === "string" &&
    value.startsWith(API_KEY_PREFIX) &&
    value.length > STORED_PREFIX_LEN
  );
}

/**
 * Lấy key thô từ request: ưu tiên header `X-API-Key`, chấp nhận thêm
 * `Authorization: Bearer agv_...` cho client chỉ set được header Authorization.
 * Trả về null khi request không mang API key (để guard rơi xuống nhánh JWT).
 */
export function extractApiKey(req: Request): string | null {
  const headerKey = req.headers?.[API_KEY_HEADER];
  const fromHeader = Array.isArray(headerKey) ? headerKey[0] : headerKey;
  if (looksLikeApiKey(fromHeader)) return fromHeader;

  const auth = req.headers?.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    const token = auth.slice(7);
    if (looksLikeApiKey(token)) return token;
  }
  return null;
}

/** Các trường của service user mà downstream (`req.user`) cần — khớp select của JwtStrategy. */
const SERVICE_USER_SELECT = {
  id: true,
  email: true,
  full_name: true,
  roles: true,
  manager_id: true,
  is_active: true,
  team: true,
  created_at: true,
  updated_at: true,
} as const;

export interface VerifiedApiKey {
  apiKeyId: string;
  name: string;
  serviceUser: {
    id: string;
    email: string;
    full_name: string;
    roles: string[];
    manager_id: string | null;
    is_active: boolean;
    team: string | null;
    created_at: Date;
    updated_at: Date;
  };
}

/**
 * Xác thực key thô. Ném `UnauthorizedException` (thay vì trả null) khi key có định dạng đúng
 * nhưng không hợp lệ — để request KHÔNG lặng lẽ rơi xuống nhánh JWT rồi báo lỗi khó hiểu.
 */
export async function verifyApiKey(
  prisma: PrismaService,
  raw: string,
): Promise<VerifiedApiKey> {
  const record = await prisma.apiKey.findUnique({
    where: { key_hash: hashApiKey(raw) },
    select: {
      id: true,
      name: true,
      is_active: true,
      revoked_at: true,
      expires_at: true,
      service_user: { select: SERVICE_USER_SELECT },
    },
  });

  if (!record || !record.is_active || record.revoked_at) {
    throw new UnauthorizedException("API key không hợp lệ hoặc đã bị thu hồi.");
  }
  if (record.expires_at && record.expires_at.getTime() <= Date.now()) {
    throw new UnauthorizedException("API key đã hết hạn.");
  }
  if (!record.service_user || !record.service_user.is_active) {
    throw new UnauthorizedException(
      "Tài khoản dịch vụ của API key đã bị vô hiệu hóa.",
    );
  }

  return {
    apiKeyId: record.id,
    name: record.name,
    serviceUser: record.service_user,
  };
}

/** Chu kỳ tối thiểu giữa 2 lần ghi `last_used_at` cho cùng một key. */
const TOUCH_THROTTLE_MS = 60_000;

/**
 * Cập nhật `last_used_at` / `last_used_ip` kiểu fire-and-forget: bỏ qua nếu vừa ghi < 60s,
 * nuốt mọi lỗi để không ảnh hưởng request chính.
 */
export function touchApiKeyUsage(
  prisma: PrismaService,
  apiKeyId: string,
  req: Request,
): void {
  const ip =
    (typeof req.headers?.["x-forwarded-for"] === "string"
      ? (req.headers["x-forwarded-for"] as string).split(",")[0].trim()
      : undefined) ||
    req.ip ||
    req.socket?.remoteAddress ||
    null;

  const cutoff = new Date(Date.now() - TOUCH_THROTTLE_MS);
  prisma.apiKey
    .updateMany({
      where: {
        id: apiKeyId,
        OR: [{ last_used_at: null }, { last_used_at: { lt: cutoff } }],
      },
      data: { last_used_at: new Date(), last_used_ip: ip },
    })
    .catch(() => {
      /* usage telemetry — không chặn request */
    });
}
