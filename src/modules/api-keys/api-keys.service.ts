import { Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "crypto";
import { Prisma, UserRole } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { CreateApiKeyDto } from "./dto/create-api-key.dto";
import { UpdateApiKeyDto } from "./dto/update-api-key.dto";
import { apiKeyPrefixOf, generateRawApiKey, hashApiKey } from "./api-key.util";

/** Chỉ các trường an toàn để trả ra ngoài — KHÔNG bao giờ kèm `key_hash`. */
const API_KEY_PUBLIC_SELECT = {
  id: true,
  name: true,
  prefix: true,
  is_active: true,
  expires_at: true,
  last_used_at: true,
  last_used_ip: true,
  revoked_at: true,
  created_at: true,
  updated_at: true,
  created_by: true,
  service_user: { select: { id: true, email: true, roles: true } },
  creator: { select: { id: true, email: true, full_name: true } },
} satisfies Prisma.ApiKeySelect;

@Injectable()
export class ApiKeysService {
  constructor(private readonly prisma: PrismaService) {}

  /** Tạo key mới + tài khoản dịch vụ đi kèm. `key` thô chỉ có trong response này. */
  async create(dto: CreateApiKeyDto, adminId: string) {
    const raw = generateRawApiKey();
    const roles = dto.roles?.length ? dto.roles : [UserRole.ADMIN];
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    const serviceEmail = `svc-${slugify(dto.name)}-${randomBytes(4).toString("hex")}@apikey.internal`;

    const created = await this.prisma.$transaction(async (tx) => {
      const serviceUser = await tx.user.create({
        data: {
          email: serviceEmail,
          full_name: `API Key: ${dto.name}`,
          roles,
          is_active: true,
        },
        select: { id: true },
      });

      return tx.apiKey.create({
        data: {
          name: dto.name,
          prefix: apiKeyPrefixOf(raw),
          key_hash: hashApiKey(raw),
          expires_at: expiresAt,
          service_user_id: serviceUser.id,
          created_by: adminId,
        },
        select: API_KEY_PUBLIC_SELECT,
      });
    });

    return { ...created, key: raw };
  }

  list() {
    return this.prisma.apiKey.findMany({
      orderBy: { created_at: "desc" },
      select: API_KEY_PUBLIC_SELECT,
    });
  }

  async getOne(id: string) {
    const found = await this.prisma.apiKey.findUnique({
      where: { id },
      select: API_KEY_PUBLIC_SELECT,
    });
    if (!found) throw new NotFoundException("Không tìm thấy API key.");
    return found;
  }

  async update(id: string, dto: UpdateApiKeyDto) {
    await this.getOne(id);

    const data: Prisma.ApiKeyUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.isActive !== undefined) data.is_active = dto.isActive;
    if (dto.expiresAt !== undefined) {
      data.expires_at = dto.expiresAt === null ? null : new Date(dto.expiresAt);
    }

    return this.prisma.apiKey.update({
      where: { id },
      data,
      select: API_KEY_PUBLIC_SELECT,
    });
  }

  /** Thu hồi vĩnh viễn: key vô hiệu ngay ở lần gọi kế tiếp. Giữ lại tài khoản dịch vụ để truy vết. */
  async revoke(id: string) {
    await this.getOne(id);
    return this.prisma.apiKey.update({
      where: { id },
      data: { is_active: false, revoked_at: new Date() },
      select: API_KEY_PUBLIC_SELECT,
    });
  }

  /** Xoá hẳn key + tài khoản dịch vụ đi kèm. */
  async remove(id: string) {
    const found = await this.prisma.apiKey.findUnique({
      where: { id },
      select: { id: true, service_user_id: true },
    });
    if (!found) throw new NotFoundException("Không tìm thấy API key.");

    await this.prisma.$transaction([
      this.prisma.apiKey.delete({ where: { id } }),
      this.prisma.user.delete({ where: { id: found.service_user_id } }),
    ]);
    return { id, deleted: true };
  }
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "") // bỏ dấu tổ hợp sau khi tách NFD
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "key"
  );
}
