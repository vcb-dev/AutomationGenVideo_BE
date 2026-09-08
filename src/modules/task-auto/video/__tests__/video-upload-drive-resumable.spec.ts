import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'
import * as fs from 'fs'
import { TaskAutoVideoService } from '../video.service'

/**
 * Upload video của editor chuyển từ "gửi chunk qua BE rồi ghép file" sang "BE mở phiên Google Drive
 * resumable, trình duyệt PUT chunk THẲNG lên Google". Lý do: chunk 8MB đi qua rewrite của Vercel
 * (www.vcbi.vn) vượt giới hạn body ~4.5MB → 502. Bộ test này khoá lại:
 *  - initChunkUpload: các cửa chặn (assignee, 2GB, Drive chưa cấu hình) + ép mimetype về video/*
 *  - chunkUploadStatus: đọc tiến độ resumable của Google, ghi lại driveFileId khi Drive báo xong
 *  - finishChunkUpload: xử lý lỗi khi Drive chưa nhận đủ / nhận thiếu byte, và KHÔNG xoá video hợp
 *    lệ đang có nếu lần nộp lại bị lỗi (validate trước khi _cleanupPendingVideo).
 */
describe('TaskAutoVideoService — upload video qua Google Drive resumable', () => {
  const GB = 1024 * 1024 * 1024
  const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=abc'

  type Meta = {
    taskId: string
    userId: string
    originalname: string
    filename: string
    mimetype: string
    totalSize: number
    uploadUrl: string
    driveFileId?: string
  }

  function build(opts: {
    task?: any
    meta?: Partial<Meta>
    isAvailable?: boolean
    resumableStatus?: { uploadedBytes: number; completed: boolean; fileId?: string }
    driveFile?: any
    pendingVideo?: any
  } = {}) {
    const task =
      opts.task === undefined
        ? { assignee_id: 'user-1', assignee: { full_name: 'Editor Uno', email: 'uno@vcb.vn' } }
        : opts.task

    const prisma: any = {
      task: {
        findUnique: jest.fn(async () => task),
        update: jest.fn(async () => ({})),
      },
      taskPendingVideo: {
        upsert: jest.fn(async () => ({})),
        findUnique: jest.fn(async () => opts.pendingVideo ?? null),
        delete: jest.fn(async () => ({})),
      },
    }
    const uploadService: any = {}
    const library: any = {
      save: jest.fn(async () => ({})),
      removeByDriveFileId: jest.fn(async () => ({})),
    }
    const googleDrive: any = {
      isAvailable: jest.fn(() => opts.isAvailable ?? true),
      createResumableUpload: jest.fn(async () => ({ uploadUrl: UPLOAD_URL, fileId: '' })),
      getResumableStatus: jest.fn(async () => opts.resumableStatus ?? { uploadedBytes: 0, completed: false }),
      getFile: jest.fn(async () =>
        opts.driveFile ?? {
          fileId: 'drive-file-1',
          name: 'task_task-1_1.mp4',
          mimetype: 'video/mp4',
          size: 100,
          url: 'https://drive.usercontent.google.com/download?id=drive-file-1',
          webViewUrl: 'https://drive.google.com/file/d/drive-file-1/view',
        },
      ),
      delete: jest.fn(async () => undefined),
    }

    const meta: Meta = {
      taskId: 'task-1',
      userId: 'user-1',
      originalname: 'clip.mov',
      filename: 'task_task-1_1.mp4',
      mimetype: 'video/mp4',
      totalSize: 100,
      uploadUrl: UPLOAD_URL,
      ...opts.meta,
    }

    jest.spyOn(fs, 'existsSync').mockReturnValue(true)
    jest.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(meta) as any)
    jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined)
    jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined as any)
    jest.spyOn(fs, 'rmSync').mockImplementation(() => undefined)

    const service = new TaskAutoVideoService(prisma, uploadService, library, googleDrive)
    return { service, prisma, googleDrive, library, meta }
  }

  const lastWrite = () => {
    const calls = (fs.writeFileSync as jest.Mock).mock.calls
    return JSON.parse(calls[calls.length - 1][1] as string)
  }

  afterEach(() => jest.restoreAllMocks())

  // ── initChunkUpload ─────────────────────────────────────────────────────────

  describe('initChunkUpload', () => {
    it('mở phiên Drive resumable, trả uploadUrl + ghi meta.json, KHÔNG còn totalChunks', async () => {
      const { service, googleDrive } = build()

      const res = await service.initChunkUpload('task-1', 'user-1', {
        filename: 'clip.mp4',
        mimetype: 'video/mp4',
        totalSize: 50 * 1024 * 1024,
      })

      expect(googleDrive.createResumableUpload).toHaveBeenCalledTimes(1)
      expect(res).toEqual(
        expect.objectContaining({ uploadId: expect.any(String), uploadUrl: UPLOAD_URL, chunkSize: expect.any(Number) }),
      )
      expect(res).not.toHaveProperty('totalChunks')
      expect(lastWrite().uploadUrl).toBe(UPLOAD_URL)
    })

    it('task không tồn tại → NotFoundException, không mở phiên Drive', async () => {
      const { service, googleDrive } = build({ task: null })

      await expect(
        service.initChunkUpload('task-x', 'user-1', { filename: 'a.mp4', mimetype: 'video/mp4', totalSize: 10 }),
      ).rejects.toBeInstanceOf(NotFoundException)
      expect(googleDrive.createResumableUpload).not.toHaveBeenCalled()
    })

    it('người gọi không phải assignee của task → ForbiddenException', async () => {
      const { service } = build({ task: { assignee_id: 'someone-else', assignee: null } })

      await expect(
        service.initChunkUpload('task-1', 'user-1', { filename: 'a.mp4', mimetype: 'video/mp4', totalSize: 10 }),
      ).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('file vượt 2GB → BadRequestException, không mở phiên Drive', async () => {
      const { service, googleDrive } = build()

      await expect(
        service.initChunkUpload('task-1', 'user-1', {
          filename: 'a.mp4',
          mimetype: 'video/mp4',
          totalSize: 2 * GB + 1,
        }),
      ).rejects.toBeInstanceOf(BadRequestException)
      expect(googleDrive.createResumableUpload).not.toHaveBeenCalled()
    })

    it('Google Drive chưa cấu hình (isAvailable=false) → BadRequestException', async () => {
      const { service } = build({ isAvailable: false })

      await expect(
        service.initChunkUpload('task-1', 'user-1', { filename: 'a.mp4', mimetype: 'video/mp4', totalSize: 10 }),
      ).rejects.toBeInstanceOf(BadRequestException)
    })

    it('mimetype không phải video/* → ép về video/mp4 khi mở phiên Drive và khi ghi meta', async () => {
      const { service, googleDrive } = build()

      await service.initChunkUpload('task-1', 'user-1', {
        filename: 'clip.bin',
        mimetype: 'application/octet-stream',
        totalSize: 10,
      })

      expect(googleDrive.createResumableUpload.mock.calls[0][1]).toBe('video/mp4')
      expect(lastWrite().mimetype).toBe('video/mp4')
    })
  })

  // ── chunkUploadStatus ──────────────────────────────────────────────────────

  describe('chunkUploadStatus', () => {
    it('Drive báo completed + fileId → trả tiến độ và persist driveFileId vào meta', async () => {
      const { service } = build({
        resumableStatus: { uploadedBytes: 100, completed: true, fileId: 'drive-file-1' },
      })

      const res = await service.chunkUploadStatus('up-1', 'user-1')

      expect(res).toEqual({
        uploadedBytes: 100,
        totalSize: 100,
        completed: true,
        driveFileId: 'drive-file-1',
      })
      expect(lastWrite().driveFileId).toBe('drive-file-1')
    })

    it('Drive báo chưa xong → completed=false, không ghi lại meta', async () => {
      const { service } = build({ resumableStatus: { uploadedBytes: 40, completed: false } })

      const res = await service.chunkUploadStatus('up-1', 'user-1')

      expect(res.completed).toBe(false)
      expect(res.uploadedBytes).toBe(40)
      expect(fs.writeFileSync).not.toHaveBeenCalled()
    })

    it('phiên upload không thuộc về người gọi → ForbiddenException', async () => {
      const { service } = build({ meta: { userId: 'someone-else' } })

      await expect(service.chunkUploadStatus('up-1', 'user-1')).rejects.toBeInstanceOf(ForbiddenException)
    })
  })

  // ── finishChunkUpload ──────────────────────────────────────────────────────

  describe('finishChunkUpload', () => {
    it('có driveFileId do FE bắt được từ chunk cuối → KHÔNG hỏi lại resumable status, đăng ký pending video + set result_url', async () => {
      const { service, prisma, googleDrive, library } = build()

      const res = await service.finishChunkUpload('up-1', 'user-1', 'task-1', 'drive-file-1')

      expect(googleDrive.getResumableStatus).not.toHaveBeenCalled()
      expect(googleDrive.getFile).toHaveBeenCalledWith('drive-file-1', true)
      expect(prisma.taskPendingVideo.upsert).toHaveBeenCalledTimes(1)
      expect(prisma.task.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: { result_url: 'https://drive.google.com/file/d/drive-file-1/view' },
      })
      expect(library.save).toHaveBeenCalledTimes(1)
      expect(res).toEqual(
        expect.objectContaining({
          storage: 'google_drive',
          url: 'https://drive.google.com/file/d/drive-file-1/view',
        }),
      )
    })

    it('không có driveFileId ở đâu + Drive báo chưa xong → BadRequestException kèm số byte, chưa đụng tới pending video cũ', async () => {
      const { service, prisma } = build({
        meta: { driveFileId: undefined },
        resumableStatus: { uploadedBytes: 30, completed: false },
      })

      await expect(service.finishChunkUpload('up-1', 'user-1', 'task-1')).rejects.toThrow(/30\/100/)
      expect(prisma.taskPendingVideo.upsert).not.toHaveBeenCalled()
      expect(prisma.taskPendingVideo.findUnique).not.toHaveBeenCalled()
    })

    it('file trên Drive nhỏ hơn totalSize → xoá file lỗi trên Drive + BadRequestException, KHÔNG dọn video hợp lệ đang có', async () => {
      const { service, prisma, googleDrive } = build({
        meta: { totalSize: 100 },
        driveFile: {
          fileId: 'drive-file-1',
          name: 'task_task-1_1.mp4',
          mimetype: 'video/mp4',
          size: 60,
          url: 'u',
          webViewUrl: 'w',
        },
      })

      await expect(
        service.finishChunkUpload('up-1', 'user-1', 'task-1', 'drive-file-1'),
      ).rejects.toBeInstanceOf(BadRequestException)
      expect(googleDrive.delete).toHaveBeenCalledWith('drive-file-1')
      expect(prisma.taskPendingVideo.upsert).not.toHaveBeenCalled()
      expect(prisma.taskPendingVideo.findUnique).not.toHaveBeenCalled()
    })

    it('phiên upload thuộc task khác → BadRequestException', async () => {
      const { service } = build({ meta: { taskId: 'task-999' } })

      await expect(
        service.finishChunkUpload('up-1', 'user-1', 'task-1', 'drive-file-1'),
      ).rejects.toBeInstanceOf(BadRequestException)
    })

    it('không truyền driveFileId nhưng meta đã có (từ lần gọi status trước) → dùng luôn, không hỏi lại Drive', async () => {
      const { service, googleDrive } = build({ meta: { driveFileId: 'drive-file-1' } })

      await service.finishChunkUpload('up-1', 'user-1', 'task-1')

      expect(googleDrive.getResumableStatus).not.toHaveBeenCalled()
      expect(googleDrive.getFile).toHaveBeenCalledWith('drive-file-1', true)
    })
  })
})
