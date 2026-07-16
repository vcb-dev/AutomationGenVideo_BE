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
  totalChunks: number
  chunkSize: number
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
  ) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } })
    if (!task) throw new NotFoundException('Task not found')
    if (task.assignee_id !== userId) throw new ForbiddenException('Chỉ người được giao mới có thể upload video')
    if (data.totalSize > 2 * 1024 * 1024 * 1024) throw new BadRequestException('File vượt quá giới hạn 2GB')

    const ext = path.extname(data.filename).toLowerCase() || '.mp4'
    const filename = `task_${taskId}_${Date.now()}${ext}`
    const totalChunks = Math.ceil(data.totalSize / CHUNK_SIZE)
    const uploadId = `${Date.now()}_${Math.random().toString(36).slice(2)}_${userId}`

    const dir = this.sessionDir(uploadId)
    fs.mkdirSync(dir, { recursive: true })

    const meta: UploadMeta = {
      taskId, userId,
      originalname: data.filename,
      filename,
      mimetype: data.mimetype,
      totalSize: data.totalSize,
      totalChunks,
      chunkSize: CHUNK_SIZE,
    }
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta))

    this.logger.log(`[VideoUpload] Init ${uploadId} — task ${taskId} | ${(data.totalSize / 1024 / 1024).toFixed(1)}MB | ${totalChunks} chunks`)
    return { uploadId, chunkSize: CHUNK_SIZE, totalChunks }
  }

  // ── 2. Receive one chunk ─────────────────────────────────────────────────────

  async receiveChunk(uploadId: string, userId: string, buffer: Buffer, chunkIndex: number) {
    const meta = this.readMeta(uploadId)
    if (meta.userId !== userId) throw new ForbiddenException('Upload session không thuộc về bạn')
    if (chunkIndex < 0 || chunkIndex >= meta.totalChunks) {
      throw new BadRequestException(`Chunk index ${chunkIndex} không hợp lệ (total ${meta.totalChunks})`)
    }

    const chunkPath = path.join(this.sessionDir(uploadId), `chunk_${chunkIndex}`)
    fs.writeFileSync(chunkPath, buffer)

    this.logger.log(`[VideoUpload] ${uploadId}: chunk ${chunkIndex + 1}/${meta.totalChunks}`)
    return { received: chunkIndex }
  }

  // ── 3. Finish: assemble chunks, register pending video ───────────────────────

  async finishChunkUpload(uploadId: string, userId: string, taskId: string) {
    const meta = this.readMeta(uploadId)
    if (meta.userId !== userId) throw new ForbiddenException('Upload session không thuộc về bạn')
    if (meta.taskId !== taskId) throw new BadRequestException('Upload session không thuộc về task này')

    const sessionDir = this.sessionDir(uploadId)
    for (let i = 0; i < meta.totalChunks; i++) {
      if (!fs.existsSync(path.join(sessionDir, `chunk_${i}`))) {
        throw new BadRequestException(`Thiếu chunk ${i}/${meta.totalChunks - 1}`)
      }
    }

    // Xóa Drive file + pending record cũ (nếu có) trước khi upload mới
    await this._cleanupPendingVideo(taskId)

    // Ghép chunks thành file tạm
    const videoDir = path.join(PENDING_DIR, 'videos')
    fs.mkdirSync(videoDir, { recursive: true })
    const ext = path.extname(meta.filename).toLowerCase() || '.mp4'
    const tmpPath = path.join(videoDir, `${taskId}_tmp${ext}`)

    const fh = await fs.promises.open(tmpPath, 'w')
    try {
      for (let i = 0; i < meta.totalChunks; i++) {
        const chunkData = await fs.promises.readFile(path.join(sessionDir, `chunk_${i}`))
        await fh.write(chunkData)
      }
    } finally {
      await fh.close()
    }
    fs.rmSync(sessionDir, { recursive: true, force: true })

    const { size } = fs.statSync(tmpPath)
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { assignee_id: true, assignee: { select: { full_name: true, email: true } } },
    })
    const userObj = task?.assignee_id
      ? { id: task.assignee_id, full_name: task.assignee?.full_name, email: task.assignee?.email }
      : null

    // Upload thẳng lên Drive — Google Drive tự xử lý codec, không cần transcode
    this.logger.log(`[VideoUpload] Uploading task ${taskId} → Drive (${(size / 1024 / 1024).toFixed(1)}MB)...`)
    let driveResult: { fileId: string; url: string; webViewUrl?: string }
    try {
      driveResult = await this.googleDrive.uploadFromPath(tmpPath, meta.filename, meta.mimetype || 'video/mp4', userObj)
      this.logger.log(`[VideoUpload] ✅ Drive upload xong — task ${taskId} | fileId=${driveResult.fileId}`)
    } finally {
      fs.rmSync(tmpPath, { force: true }) // luôn xóa file tạm
    }

    const webViewUrl = driveResult.webViewUrl

    // Lưu metadata (để có thể xóa Drive file khi task bị REJECT) và cập nhật result_url — 2 ghi
    // độc lập trên 2 bảng khác nhau, chạy song song thay vì tuần tự.
    await Promise.all([
      (this.prisma as any).taskPendingVideo
        .upsert({
          where:  { task_id: taskId },
          create: { task_id: taskId, uploader_id: userId, filename: meta.filename, originalname: meta.originalname, mimetype: meta.mimetype || 'video/mp4', size, url: driveResult.url, storage: 'google_drive', drive_file_id: driveResult.fileId, web_view_url: webViewUrl },
          update: { uploader_id: userId, filename: meta.filename, originalname: meta.originalname, mimetype: meta.mimetype || 'video/mp4', size, url: driveResult.url, storage: 'google_drive', drive_file_id: driveResult.fileId, web_view_url: webViewUrl },
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
        mimetype: meta.mimetype || 'video/mp4',
        size,
        url: driveResult.url,
        storage: 'google_drive',
        drive_file_id: driveResult.fileId,
        drive_web_view_url: webViewUrl,
      }).catch(err => this.logger.warn(`[VideoUpload] library.save failed: ${err.message}`))
    }

    this.logger.log(`[VideoUpload] ✅ ${uploadId} done — task ${taskId}`)
    return { url: webViewUrl, filename: meta.filename, originalname: meta.originalname, mimetype: meta.mimetype || 'video/mp4', size, storage: 'google_drive' }
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
