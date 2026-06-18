import {
  Injectable, NotFoundException, ForbiddenException, Logger,
} from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import * as fs from 'fs'
import * as path from 'path'

const UPLOAD_DIR = process.env.SOCIAL_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'social')

const TABLE_NOT_READY = ['P2021', 'P2022', 'P2010']

function isTableMissing(err: any): boolean {
  if (TABLE_NOT_READY.includes(err?.code)) return true
  const msg: string = err?.message || ''
  return msg.includes('does not exist') || msg.includes('task_pending_videos')
}

@Injectable()
export class TaskAutoVideoService {
  private readonly logger = new Logger(TaskAutoVideoService.name)

  constructor(private readonly prisma: PrismaService) {}

  /** Gắn video đã upload (qua /social/upload/chunk/*) vào task */
  async attachVideo(
    taskId: string,
    userId: string,
    data: { filename: string; originalname: string; mimetype: string; size: number; url: string; storage: string },
  ) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } })
    if (!task) throw new NotFoundException('Task not found')
    if (task.assignee_id !== userId) throw new ForbiddenException('Chỉ người được giao mới có thể upload video')

    try {
      await (this.prisma as any).taskPendingVideo.upsert({
        where: { task_id: taskId },
        create: { task_id: taskId, uploader_id: userId, ...data },
        update: { uploader_id: userId, ...data },
      })
    } catch (err: any) {
      if (isTableMissing(err)) {
        this.logger.warn('[Video] Bảng task_pending_videos chưa tồn tại')
        return null
      }
      throw err
    }

    // Cập nhật result_url để task biết có video
    await this.prisma.task.update({
      where: { id: taskId },
      data: { result_url: data.url },
    })

    return (this.prisma as any).taskPendingVideo.findUnique({ where: { task_id: taskId } })
  }

  /** LEADER promote video sang thư viện media của họ */
  async promoteToLibrary(taskId: string, leaderId: string) {
    let pending: any
    try {
      pending = await (this.prisma as any).taskPendingVideo.findUnique({ where: { task_id: taskId } })
    } catch (err: any) {
      if (isTableMissing(err)) throw new NotFoundException('Không có video pending cho task này')
      throw err
    }

    if (!pending) throw new NotFoundException('Không có video pending cho task này')

    // Tạo bản ghi trong thư viện media của LEADER
    let libraryItem: any = null
    try {
      libraryItem = await (this.prisma as any).socialUploadedFile.create({
        data: {
          user_id: leaderId,
          filename: pending.filename,
          originalname: pending.originalname,
          mimetype: pending.mimetype,
          size: pending.size,
          url: pending.url,
          storage: pending.storage,
        },
      })
    } catch (err: any) {
      this.logger.warn(`[Video] Không lưu được vào media library: ${err.message}`)
    }

    // Xoá bản ghi pending (file vật lý giữ nguyên vì đã được dùng trong media library)
    try {
      await (this.prisma as any).taskPendingVideo.delete({ where: { task_id: taskId } })
    } catch {}

    return libraryItem
  }

  /** Xoá pending video (khi reject hoặc editor muốn upload lại) */
  async removeVideo(taskId: string, userId: string, roles: string[]) {
    let pending: any
    try {
      pending = await (this.prisma as any).taskPendingVideo.findUnique({ where: { task_id: taskId } })
    } catch (err: any) {
      if (isTableMissing(err)) return null
      throw err
    }

    if (!pending) return null

    const task = await this.prisma.task.findUnique({ where: { id: taskId } })
    const isPrivileged = roles.some(r => ['ADMIN', 'MANAGER', 'LEADER'].includes(r))
    const isOwner = pending.uploader_id === userId

    if (!isOwner && !isPrivileged) throw new ForbiddenException('Không có quyền xoá video này')

    // Xoá file local nếu có
    if (pending.storage === 'local') {
      const localPath = path.join(UPLOAD_DIR, pending.filename)
      try { fs.unlinkSync(localPath) } catch {}
    }

    try {
      await (this.prisma as any).taskPendingVideo.delete({ where: { task_id: taskId } })
    } catch {}

    // Reset result_url nếu đang trỏ về video này
    if (task?.result_url === pending.url) {
      await this.prisma.task.update({ where: { id: taskId }, data: { result_url: null } })
    }

    return { deleted: true }
  }

  async getPendingVideo(taskId: string) {
    try {
      return await (this.prisma as any).taskPendingVideo.findUnique({ where: { task_id: taskId } })
    } catch (err: any) {
      if (isTableMissing(err)) return null
      throw err
    }
  }
}
