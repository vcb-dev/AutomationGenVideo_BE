import {
  Injectable, NotFoundException, ForbiddenException, Logger, BadRequestException,
} from '@nestjs/common'
import { PrismaService } from '../../../common/prisma/prisma.service'
import { UploadService } from '../../social-publishing/upload/upload.service'
import { MediaLibraryService } from '../../social-publishing/upload/media-library.service'
import { GoogleDriveStorageService } from '../../social-publishing/upload/google-drive-storage.service'
import * as fs from 'fs'
import * as path from 'path'
import type { Response } from 'express'
import * as ffmpeg from 'fluent-ffmpeg'
import * as ffmpegInstaller from '@ffmpeg-installer/ffmpeg'

ffmpeg.setFfmpegPath(ffmpegInstaller.path)

const PENDING_DIR = process.env.TASK_PENDING_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'task-pending')
const CHUNK_SIZE = 8 * 1024 * 1024 // 8 MB per chunk

const TABLE_NOT_READY = ['P2021', 'P2022', 'P2010']

function isTableMissing(err: any): boolean {
  if (TABLE_NOT_READY.includes(err?.code)) return true
  const msg: string = err?.message || ''
  return msg.includes('does not exist') || msg.includes('task_pending_videos')
}

interface UploadMeta {
  taskId: string
  userId: string
  originalname: string
  filename: string
  mimetype: string
  totalSize: number
  uploadUrl: string
  driveFileId?: string
}

@Injectable()
export class TaskAutoVideoService {
  private readonly logger = new Logger(TaskAutoVideoService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
    private readonly library: MediaLibraryService,
    private readonly googleDrive: GoogleDriveStorageService,
  ) {}

  // ── Path helpers ────────────────────────────────────────────────────────────

  private sessionDir(uploadId: string) {
    return path.join(PENDING_DIR, 'sessions', uploadId)
  }

  private taskVideoPath(taskId: string, ext: string) {
    return path.join(PENDING_DIR, 'videos', `${taskId}${ext}`)
  }

  // Transcode bất kỳ codec nào → H.264 + AAC .mp4 để browser play được
  private transcodeToH264(inputPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions([
          '-c:v libx264',
          '-preset fast',
          '-crf 23',
          '-c:a aac',
          '-b:a 128k',
          '-movflags +faststart', // moov atom ở đầu → browser có thể stream ngay
          '-pix_fmt yuv420p',     // tương thích tối đa với mọi browser
        ])
        .output(outputPath)
        .on('end', () => resolve())
        .on('error', (err) => reject(err))
        .run()
    })
  }

  private readMeta(uploadId: string): UploadMeta {
    const p = path.join(this.sessionDir(uploadId), 'meta.json')
    if (!fs.existsSync(p)) throw new BadRequestException('Upload session không tồn tại hoặc đã hết hạn')
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  }

  // ── 1. Init chunk upload session ─────────────────────────────────────────────

  async initChunkUpload(
    taskId: string,
    userId: string,
    data: { filename: string; mimetype: string; totalSize: number },
    origin?: string,
  ) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { assignee_id: true, assignee: { select: { full_name: true, email: true } } },
    })
    if (!task) throw new NotFoundException('Task not found')
    if (task.assignee_id !== userId) throw new ForbiddenException('Chỉ người được giao mới có thể upload video')
    if (data.totalSize > 2 * 1024 * 1024 * 1024) throw new BadRequestException('File vượt quá giới hạn 2GB')
    if (!this.googleDrive.isAvailable()) throw new BadRequestException('Google Drive storage chưa được cấu hình')

    const ext = path.extname(data.filename).toLowerCase() || '.mp4'
    const filename = `task_${taskId}_${Date.now()}${ext}`
    const mimetype = /^video\//.test(data.mimetype || '') ? data.mimetype : 'video/mp4'
    const uploadId = `${Date.now()}_${Math.random().toString(36).slice(2)}_${userId}`

    const driveOrigin = origin || process.env.FRONTEND_URL || process.env.CORS_ORIGIN || 'https://www.vcbi.vn'
    const userObj = task.assignee_id
      ? { id: task.assignee_id, full_name: task.assignee?.full_name, email: task.assignee?.email }
      : null
    const { uploadUrl } = await this.googleDrive.createResumableUpload(
      filename, mimetype, data.totalSize, userObj, driveOrigin,
    )

    const dir = this.sessionDir(uploadId)
    fs.mkdirSync(dir, { recursive: true })

    const meta: UploadMeta = {
      taskId, userId,
      originalname: data.filename,
      filename,
      mimetype,
      totalSize: data.totalSize,
      uploadUrl,
    }
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta))

    this.logger.log(`[VideoUpload] Init ${uploadId} — task ${taskId} | ${(data.totalSize / 1024 / 1024).toFixed(1)}MB → Google Drive resumable`)
    return { uploadId, uploadUrl, chunkSize: CHUNK_SIZE }
  }

  // ── 2. Query resumable status trên Drive (để FE resume khi 1 chunk lỗi) ──────

  async chunkUploadStatus(uploadId: string, userId: string) {
    const meta = this.readMeta(uploadId)
    if (meta.userId !== userId) throw new ForbiddenException('Upload session không thuộc về bạn')

    const status = await this.googleDrive.getResumableStatus(meta.uploadUrl, meta.totalSize)
    if (status.completed && status.fileId && !meta.driveFileId) {
      meta.driveFileId = status.fileId
      fs.writeFileSync(path.join(this.sessionDir(uploadId), 'meta.json'), JSON.stringify(meta))
    }
    return {
      uploadedBytes: status.uploadedBytes,
      totalSize: meta.totalSize,
      completed: status.completed,
      driveFileId: status.fileId || meta.driveFileId,
    }
  }

  // ── 3. Finish: xác nhận Drive đã nhận đủ, đăng ký video tạm ─────────────────

  async finishChunkUpload(uploadId: string, userId: string, taskId: string, driveFileId?: string) {
    const meta = this.readMeta(uploadId)
    if (meta.userId !== userId) throw new ForbiddenException('Upload session không thuộc về bạn')
    if (meta.taskId !== taskId) throw new BadRequestException('Upload session không thuộc về task này')

    let fileId = driveFileId || meta.driveFileId
    if (!fileId) {
      const status = await this.googleDrive.getResumableStatus(meta.uploadUrl, meta.totalSize)
      if (!status.completed) {
        throw new BadRequestException(`Upload chưa hoàn tất trên Google Drive (${status.uploadedBytes}/${meta.totalSize} bytes)`)
      }
      fileId = status.fileId
    }
    if (!fileId) throw new BadRequestException('Không lấy được Google Drive file ID sau khi upload')

    const file = await this.googleDrive.getFile(fileId, true)
    const size = Number(file.size) || meta.totalSize
    if (size > 0 && meta.totalSize > 0 && size < meta.totalSize) {
      await this.googleDrive.delete(fileId).catch(() => {})
      throw new BadRequestException('Video trên Google Drive chưa upload đủ dung lượng — thử nộp lại')
    }

    const mimetype = file.mimetype || meta.mimetype || 'video/mp4'
    const webViewUrl = file.webViewUrl || undefined

    // Xóa Drive file + pending record cũ (nếu có) trước khi upload mới
    await this._cleanupPendingVideo(taskId)

    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { assignee_id: true },
    })

    // Lưu metadata (để có thể xóa Drive file khi task bị REJECT) và cập nhật result_url — 2 ghi
    // độc lập trên 2 bảng khác nhau, chạy song song thay vì tuần tự.
    await Promise.all([
      (this.prisma as any).taskPendingVideo
        .upsert({
          where:  { task_id: taskId },
          create: { task_id: taskId, uploader_id: userId, filename: meta.filename, originalname: meta.originalname, mimetype, size, url: file.url, storage: 'google_drive', drive_file_id: fileId, web_view_url: webViewUrl },
          update: { uploader_id: userId, filename: meta.filename, originalname: meta.originalname, mimetype, size, url: file.url, storage: 'google_drive', drive_file_id: fileId, web_view_url: webViewUrl },
        })
        .catch((err: any) => {
          if (isTableMissing(err)) this.logger.warn('[VideoUpload] Bảng task_pending_videos chưa tồn tại')
          else throw err
        }),
      // result_url = webViewUrl để FE embed Drive iframe
      this.prisma.task.update({ where: { id: taskId }, data: { result_url: webViewUrl } }),
    ])

    // Lưu ngay vào media library để hiển thị trong Thư viện media
    if (task?.assignee_id) {
      await this.library.save(task.assignee_id, {
        filename: meta.filename,
        originalname: meta.originalname,
        mimetype,
        size,
        url: file.url,
        storage: 'google_drive',
        drive_file_id: fileId,
        drive_web_view_url: webViewUrl,
      }).catch(err => this.logger.warn(`[VideoUpload] library.save failed: ${err.message}`))
    }

    fs.rmSync(this.sessionDir(uploadId), { recursive: true, force: true })

    this.logger.log(`[VideoUpload] ✅ ${uploadId} done — task ${taskId} | fileId=${fileId}`)
    return { url: webViewUrl, filename: meta.filename, originalname: meta.originalname, mimetype, size, storage: 'google_drive' }
  }

  // ── 4. Stream local pending video (for review) ───────────────────────────────

  async streamVideo(taskId: string, res: Response) {
    let pending: any
    try {
      pending = await (this.prisma as any).taskPendingVideo.findUnique({ where: { task_id: taskId } })
    } catch (err: any) {
      if (isTableMissing(err)) throw new NotFoundException('Không có video pending cho task này')
      throw err
    }
    if (!pending) throw new NotFoundException('Không có video pending cho task này')

    const localPath = this.taskVideoPath(taskId, '.mp4')
    if (!fs.existsSync(localPath)) throw new NotFoundException('File video không còn tồn tại trên server')

    // res.sendFile handles Range requests automatically + preserves CORS headers from middleware
    res.sendFile(path.resolve(localPath), (err: any) => {
      if (!err) return
      if (err.code === 'ECONNRESET' || err.code === 'ECONNABORTED' || err.message === 'Request aborted') return
      if (!res.headersSent) {
        this.logger.error(`[VideoStream] sendFile error for task ${taskId}: ${err.message}`)
        res.status(500).json({ message: 'Lỗi khi stream video' })
      }
    })
  }

  // ── 5. On APPROVE: upload local file to Drive ────────────────────────────────

  async uploadPendingToDrive(taskId: string) {
    let pending: any
    try {
      pending = await (this.prisma as any).taskPendingVideo.findUnique({ where: { task_id: taskId } })
    } catch (err: any) {
      if (isTableMissing(err)) { this.logger.warn('[VideoApprove] Bảng task_pending_videos chưa tồn tại'); return null }
      throw err
    }

    if (!pending) { this.logger.warn(`[VideoApprove] Task ${taskId}: không có video pending`); return null }

    // Video đã trên Drive (upload khi nộp) — media library đã lưu lúc nộp, chỉ cần xóa pending record
    if (pending.storage === 'google_drive') {
      await (this.prisma as any).taskPendingVideo.delete({ where: { task_id: taskId } }).catch(() => {})
      this.logger.log(`[VideoApprove] ✅ Task ${taskId} approved — video already on Drive and in media library`)
      return pending.url
    }

    const localPath = this.taskVideoPath(taskId, '.mp4')
    if (!fs.existsSync(localPath)) {
      this.logger.warn(`[VideoApprove] Local file not found: ${localPath} — skipping Drive upload`)
      await (this.prisma as any).taskPendingVideo.delete({ where: { task_id: taskId } }).catch(() => {})
      return null
    }

    // Chỉ fetch task khi thật sự cần upload lên Drive (dùng cho userObj metadata) — 2 nhánh
    // early-return ở trên không dùng tới nên không cần fetch trước.
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { assignee_id: true, assignee: { select: { full_name: true, email: true } } },
    })
    const ownerId = task?.assignee_id

    this.logger.log(`[VideoApprove] Uploading task ${taskId} → Drive (${(pending.size / 1024 / 1024).toFixed(1)}MB)`)

    const userObj = ownerId
      ? { id: ownerId, full_name: task.assignee?.full_name, email: task.assignee?.email }
      : null
    let driveUrl: string
    let driveFileId: string | undefined

    try {
      const uploaded = await this.googleDrive.uploadFromPath(localPath, pending.filename, pending.mimetype, userObj)
      driveUrl = uploaded.url
      driveFileId = uploaded.fileId
    } catch (err: any) {
      this.logger.error(`[VideoApprove] Drive upload failed for task ${taskId}: ${err.message}`)
      throw err
    }

    try { fs.unlinkSync(localPath) } catch {}

    if (ownerId) {
      await this.library.save(ownerId, {
        filename: pending.filename, originalname: pending.originalname,
        mimetype: pending.mimetype, size: pending.size,
        url: driveUrl, storage: 'google_drive',
        drive_file_id: driveFileId,
      }).catch(err => this.logger.warn(`[VideoApprove] library.save failed: ${err.message}`))
    }

    // 2 ghi độc lập trên 2 bảng khác nhau — chạy song song.
    await Promise.all([
      this.prisma.task.update({ where: { id: taskId }, data: { result_url: driveUrl } }),
      (this.prisma as any).taskPendingVideo.delete({ where: { task_id: taskId } }).catch(() => {}),
    ])

    this.logger.log(`[VideoApprove] ✅ Task ${taskId} promoted to Drive: ${driveUrl}`)
    return driveUrl
  }

  // ── 6. Remove pending video (reject / re-upload) ─────────────────────────────

  async removeVideo(taskId: string, userId: string, roles: string[]) {
    let pending: any
    let task: any
    try {
      // 2 lookup độc lập nhau (chỉ cùng khoá theo taskId) — chạy song song thay vì tuần tự.
      ;[pending, task] = await Promise.all([
        (this.prisma as any).taskPendingVideo.findUnique({ where: { task_id: taskId } }),
        this.prisma.task.findUnique({ where: { id: taskId } }),
      ])
    } catch (err: any) {
      if (isTableMissing(err)) return null
      throw err
    }
    if (!pending) return null

    const isPrivileged = roles.some(r => ['ADMIN', 'MANAGER', 'LEADER'].includes(r))
    const isOwner = pending.uploader_id === userId
    if (!isOwner && !isPrivileged) throw new ForbiddenException('Không có quyền xoá video này')

    await this._deletePendingStorage(pending)
    await (this.prisma as any).taskPendingVideo.delete({ where: { task_id: taskId } }).catch(() => {})

    if (task?.result_url === pending.url || task?.result_url === pending.web_view_url || task?.result_url?.startsWith('/task-auto/tasks/')) {
      await this.prisma.task.update({ where: { id: taskId }, data: { result_url: null } })
    }

    return { deleted: true }
  }

  async deletePendingVideo(taskId: string) {
    return this._cleanupPendingVideo(taskId)
  }

  async getPendingVideo(taskId: string) {
    try {
      return await (this.prisma as any).taskPendingVideo.findUnique({ where: { task_id: taskId } })
    } catch (err: any) {
      if (isTableMissing(err)) return null
      throw err
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private async _deletePendingStorage(pending: any) {
    if (!pending) return
    if (pending.storage === 'google_drive' && pending.drive_file_id) {
      await this.googleDrive.delete(pending.drive_file_id).catch((err: any) =>
        this.logger.warn(`[VideoCleanup] Could not delete Drive file ${pending.drive_file_id}: ${err.message}`)
      )
      await this.library.removeByDriveFileId(pending.drive_file_id).catch((err: any) =>
        this.logger.warn(`[VideoCleanup] Could not remove library entry for Drive file ${pending.drive_file_id}: ${err.message}`)
      )
    } else if (pending.storage === 'local') {
      const localPath = this.taskVideoPath(pending.task_id, '.mp4')
      try { fs.unlinkSync(localPath) } catch {}
    }
  }

  private async _cleanupPendingVideo(taskId: string) {
    let pending: any
    try {
      pending = await (this.prisma as any).taskPendingVideo.findUnique({ where: { task_id: taskId } })
    } catch { return }
    if (!pending) return

    await this._deletePendingStorage(pending)
    await (this.prisma as any).taskPendingVideo.delete({ where: { task_id: taskId } }).catch(() => {})
  }
}
