import { Injectable, Logger, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CollectionType, UserRole } from '@prisma/client';
import { SaveToLibraryDto } from './dto/video-library.dto';

@Injectable()
export class VideoLibraryService {
    private readonly logger = new Logger(VideoLibraryService.name);

    constructor(private readonly prisma: PrismaService) {}

    /** Determine collection type from user role */
    private resolveCollectionType(role: UserRole): CollectionType {
        if (role === UserRole.LEADER) return CollectionType.TEAM;
        return CollectionType.SHARED; // ADMIN, MANAGER
    }

    async save(dto: SaveToLibraryDto, userId: string, userName: string, role: UserRole) {
        const collectionType = this.resolveCollectionType(role);

        try {
            const existing = await this.prisma.videoLibrary.findUnique({
                where: { video_id_collection_type: { video_id: dto.video_id, collection_type: collectionType } },
            });
            if (existing) {
                throw new ConflictException('Video đã có trong bộ sưu tập này');
            }

            const saved = await this.prisma.videoLibrary.create({
                data: {
                    video_id: dto.video_id,
                    platform: dto.platform.toUpperCase(),
                    title: dto.title,
                    description: dto.description ?? '',
                    video_url: dto.video_url,
                    author_username: dto.author_username,
                    author_name: dto.author_name ?? dto.author_username,
                    thumbnail_url: dto.thumbnail_url ?? null,
                    views_count: BigInt(dto.views_count ?? 0),
                    likes_count: BigInt(dto.likes_count ?? 0),
                    comments_count: BigInt(dto.comments_count ?? 0),
                    shares_count: BigInt(dto.shares_count ?? 0),
                    collection_type: collectionType,
                    added_by_id: userId,
                    added_by_name: userName,
                    added_by_role: role,
                    notes: dto.notes ?? null,
                    sourcing_url: dto.sourcing_url ?? null,
                },
            });

            this.logger.log(`Video ${dto.video_id} saved to ${collectionType} by ${userName} (${role})`);
            return { ...saved, views_count: Number(saved.views_count), likes_count: Number(saved.likes_count), comments_count: Number(saved.comments_count), shares_count: Number(saved.shares_count), collection_type: collectionType };
        } catch (err) {
            if (err instanceof ConflictException) throw err;
            this.logger.error(`Failed to save video: ${err.message}`);
            throw err;
        }
    }

    async getByType(collectionType: CollectionType) {
        try {
            const items = await this.prisma.videoLibrary.findMany({
                where: { collection_type: collectionType },
                orderBy: { created_at: 'desc' },
            });
            return items.map((item) => ({
                ...item,
                views_count: Number(item.views_count),
                likes_count: Number(item.likes_count),
                comments_count: Number(item.comments_count),
                shares_count: Number(item.shares_count),
            }));
        } catch (err: any) {
            const code = err?.code;
            const msg = String(err?.message || '');
            if (code === 'P2021' && msg.includes('does not exist')) {
                this.logger.warn(`video_library table missing (collectionType=${collectionType}); returning empty list`);
                return [];
            }
            throw err;
        }
    }

    async remove(id: string, userId: string, role: UserRole) {
        const item = await this.prisma.videoLibrary.findUnique({ where: { id } });
        if (!item) throw new NotFoundException('Không tìm thấy video');

        // Only the uploader or admin/manager can remove
        const canDelete =
            item.added_by_id === userId ||
            role === UserRole.ADMIN ||
            role === UserRole.MANAGER;

        if (!canDelete) throw new NotFoundException('Không có quyền xóa video này');

        await this.prisma.videoLibrary.delete({ where: { id } });
        return { success: true };
    }

    /** Return all distinct video_ids that have been saved to any collection */
    async getAllSavedVideoIds(): Promise<string[]> {
        try {
            const rows = await this.prisma.videoLibrary.findMany({
                select: { video_id: true },
                distinct: ['video_id'],
            });
            return rows.map((r) => r.video_id);
        } catch (err: any) {
            const code = err?.code;
            const msg = String(err?.message || '');
            if (code === 'P2021' && msg.includes('does not exist')) {
                this.logger.warn(`video_library table missing; returning empty saved ids`);
                return [];
            }
            throw err;
        }
    }

    async checkSaved(videoId: string, collectionType: CollectionType) {
        try {
            const item = await this.prisma.videoLibrary.findUnique({
                where: { video_id_collection_type: { video_id: videoId, collection_type: collectionType } },
            });
            return { saved: !!item };
        } catch (err: any) {
            const code = err?.code;
            const msg = String(err?.message || '');
            if (code === 'P2021' && msg.includes('does not exist')) {
                return { saved: false };
            }
            throw err;
        }
    }
}
