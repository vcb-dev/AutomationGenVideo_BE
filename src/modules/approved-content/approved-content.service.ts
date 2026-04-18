import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UserRole } from '@prisma/client';
import { CreateApprovedContentDto } from './dto/approved-content.dto';

@Injectable()
export class ApprovedContentService {
    private readonly logger = new Logger(ApprovedContentService.name);

    constructor(private readonly prisma: PrismaService) {}

    async create(dto: CreateApprovedContentDto, userId: string, userName: string, role: UserRole) {
        const item = await this.prisma.approvedContent.create({
            data: {
                script: dto.script,
                content_type: dto.content_type,
                content_type_display: dto.content_type_display ?? dto.content_type,
                word_count: dto.word_count ?? 0,
                // `source_video_id` có thể là ID cực lớn (vd TikTok) nên frontend/DTO gửi dạng string.
                // Prisma client type có thể chưa được refresh đồng bộ kịp với schema runtime, nên ép kiểu để tránh lỗi TS.
                source_video_id: (dto.source_video_id ?? null) as any,
                source_video_title: dto.source_video_title ?? '',
                source_video_desc: dto.source_video_desc ?? '',
                source_video_url: dto.source_video_url ?? '',
                product_id: dto.product_id ?? null,
                product_name: dto.product_name ?? null,
                product_category: dto.product_category ?? null,
                product_sku: dto.product_sku ?? null,
                approved_by_id: userId,
                approved_by_name: userName,
                approved_by_role: role,
            },
        });

        this.logger.log(`Content approved by ${userName} (${role}), type=${dto.content_type}`);
        return item;
    }

    async findAll() {
        try {
            return this.prisma.approvedContent.findMany({
                orderBy: { created_at: 'desc' },
            });
        } catch (err: any) {
            const code = err?.code;
            const msg = String(err?.message || '');
            if (code === 'P2021' && msg.includes('does not exist')) {
                this.logger.warn(`approved_content table missing; returning empty list`);
                return [];
            }
            throw err;
        }
    }

    async remove(id: string, userId: string, role: UserRole) {
        const item = await this.prisma.approvedContent.findUnique({ where: { id } });
        if (!item) throw new NotFoundException('Không tìm thấy content');

        const canDelete =
            item.approved_by_id === userId ||
            role === UserRole.ADMIN ||
            role === UserRole.MANAGER;

        if (!canDelete) throw new NotFoundException('Không có quyền xóa content này');

        await this.prisma.approvedContent.delete({ where: { id } });
        return { success: true };
    }
}
