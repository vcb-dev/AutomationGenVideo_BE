import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateCharacterDto, UpdateCharacterDto, CharacterQueryDto } from './dto';

@Injectable()
export class CharactersService {
  private readonly logger = new Logger(CharactersService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Danh sách đầy đủ (kể cả is_active = false), có phân trang — chỉ dùng cho trang admin CRUD.
   *
   * CỐ Ý KHÔNG trả system_prompt: bảng danh sách không hiển thị field này, trong khi nó rất nặng
   * (vd HuyK ~29K ký tự) — trả kèm cho MỌI dòng khiến payload phình vô ích và lộ toàn bộ prompt
   * ra network tab dù chưa ai bấm sửa. FE lấy system_prompt qua GET /characters/:id đúng lúc mở
   * modal sửa (findOneAdmin), vừa nhẹ danh sách vừa luôn lấy được bản mới nhất.
   */
  async findAllAdmin(query: CharacterQueryDto) {
    const page = Math.max(1, query.page || 1);
    const limit = Math.max(1, Math.min(100, query.limit || 10));
    const skip = (page - 1) * limit;

    const [total, items] = await Promise.all([
      this.prisma.character.count(),
      this.prisma.character.findMany({
        orderBy: [{ order_index: 'asc' }, { created_at: 'desc' }],
        skip,
        take: limit,
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          avatar_url: true,
          is_active: true,
          order_index: true,
          created_at: true,
          updated_at: true,
          updated_by: true,
          updatedByUser: { select: { id: true, full_name: true } },
        },
      }),
    ]);

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      items,
    };
  }

  /**
   * Chi tiết 1 nhân vật, kèm system_prompt đầy đủ.
   *
   * Nhận CẢ id lẫn slug — luồng /content-transform/transform vốn cho phép truyền slug
   * (vd "huyk"), nay lấy prompt qua chính endpoint này nên phải giữ nguyên khả năng đó,
   * nếu chỉ tra theo id thì mọi lệnh gọi bằng slug sẽ vỡ thành 404.
   */
  async findOneAdmin(idOrSlug: string) {
    const character = await this.prisma.character.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
      include: {
        updatedByUser: { select: { id: true, full_name: true } },
      },
    });
    if (!character) {
      throw new NotFoundException('Không tìm thấy nhân vật');
    }
    return character;
  }

  async create(userId: string, dto: CreateCharacterDto) {
    await this.assertSlugAvailable(dto.slug);

    try {
      return await this.prisma.character.create({
        data: {
          name: dto.name,
          slug: dto.slug,
          description: dto.description,
          avatar_url: dto.avatar_url,
          system_prompt: dto.system_prompt,
          is_active: dto.is_active ?? true,
          order_index: dto.order_index ?? 0,
          updated_by: userId,
        },
        include: {
          updatedByUser: { select: { id: true, full_name: true } },
        },
      });
    } catch (err: any) {
      if (err.code === 'P2002') {
        throw new ConflictException('Tên hoặc slug đã tồn tại, vui lòng chọn giá trị khác');
      }
      throw err;
    }
  }

  /**
   * Sửa từng phần. Chống 2 người sửa đè nhau bằng optimistic concurrency check (so sánh
   * updated_at client gửi lên với bản mới nhất trong DB). Nếu có đổi system_prompt, lưu lại
   * bản CŨ vào character_system_prompt_history TRƯỚC khi ghi đè (bắt buộc — tránh lặp lại sự
   * cố mất dữ liệu do sửa prompt thủ công không có lưu vết trước đây).
   *
   * BE lưu system_prompt NGUYÊN VĂN tuyệt đối — không trim, không normalize. Riêng kiểu xuống
   * dòng: nội dung gửi từ form admin luôn đã bị trình duyệt chuẩn hoá CRLF -> LF trước khi tới
   * đây (hành vi bắt buộc của <textarea> theo chuẩn HTML, không tắt được — xem ghi chú ở
   * characters/page.tsx). Đây là hành vi đã biết và chấp nhận, không phải lỗi tầng BE; gọi
   * thẳng API bằng client khác (curl, script) thì CRLF vẫn được giữ nguyên 100%.
   */
  async update(userId: string, id: string, dto: UpdateCharacterDto) {
    const existing = await this.prisma.character.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Không tìm thấy nhân vật');
    }

    const clientUpdatedAt = new Date(dto.updated_at).getTime();
    const dbUpdatedAt = existing.updated_at.getTime();
    if (Number.isNaN(clientUpdatedAt) || clientUpdatedAt !== dbUpdatedAt) {
      throw new ConflictException('Dữ liệu đã bị thay đổi, vui lòng tải lại trước khi lưu');
    }

    if (dto.slug && dto.slug !== existing.slug) {
      await this.assertSlugAvailable(dto.slug);
    }

    const { updated_at, ...rest } = dto;
    const isChangingPrompt = rest.system_prompt !== undefined && rest.system_prompt !== existing.system_prompt;

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (isChangingPrompt) {
          await tx.characterSystemPromptHistory.create({
            data: {
              character_id: id,
              old_content: existing.system_prompt,
              changed_by: userId,
            },
          });
          this.logger.log(`[character:${id}] system_prompt changed by ${userId} — old version archived`);
        }

        return tx.character.update({
          where: { id },
          data: { ...rest, updated_by: userId },
          include: {
            updatedByUser: { select: { id: true, full_name: true } },
          },
        });
      });
    } catch (err: any) {
      if (err.code === 'P2002') {
        throw new ConflictException('Tên hoặc slug đã tồn tại, vui lòng chọn giá trị khác');
      }
      throw err;
    }
  }

  /** Lịch sử các bản cũ của system_prompt — mới nhất trước. */
  async getSystemPromptHistory(characterId: string) {
    const character = await this.prisma.character.findUnique({ where: { id: characterId } });
    if (!character) {
      throw new NotFoundException('Không tìm thấy nhân vật');
    }

    return this.prisma.characterSystemPromptHistory.findMany({
      where: { character_id: characterId },
      orderBy: { changed_at: 'desc' },
      include: {
        changedByUser: { select: { id: true, full_name: true } },
      },
    });
  }

  private async assertSlugAvailable(slug: string) {
    const existing = await this.prisma.character.findUnique({ where: { slug } });
    if (existing) {
      throw new ConflictException(`Slug "${slug}" đã được sử dụng, vui lòng chọn slug khác`);
    }
  }
}
