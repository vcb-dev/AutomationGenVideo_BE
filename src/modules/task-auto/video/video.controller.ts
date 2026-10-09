import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Response } from 'express'
import { Roles } from '../../auth/decorators/roles.decorator'
import { JwtOrApiKeyGuard } from '../../api-keys/guards/jwt-or-api-key.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { TaskAutoVideoService } from './video.service'

@ApiTags('task-auto')
@ApiBearerAuth()
@UseGuards(JwtOrApiKeyGuard)
@Controller('task-auto/tasks/:id')
export class TaskAutoVideoController {
  constructor(private readonly video: TaskAutoVideoService) {}

  @Post('promote-video')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MANAGER', 'LEADER')
  @ApiOperation({ summary: 'LEADER thủ công promote video tạm lên Drive' })
  promoteTaskVideo(@Param('id') id: string) {
    return this.video.uploadPendingToDrive(id)
  }

  @Delete('pending-video')
  @ApiOperation({ summary: 'Xoá video tạm của task' })
  deleteTaskVideo(@Param('id') id: string, @Request() request: any) {
    return this.video.removeVideo(id, request.user.id, request.user.roles ?? [])
  }

  @Post('upload-video/init')
  @ApiOperation({ summary: 'Khởi tạo phiên upload video tạm' })
  initVideoUpload(
    @Param('id') id: string,
    @Body() body: { filename: string; mimetype: string; totalSize: number },
    @Request() request: any,
  ) {
    return this.video.initChunkUpload(
      id,
      request.user.id,
      body,
      request.headers?.origin,
    )
  }

  @Post('upload-video/status')
  @ApiOperation({ summary: 'Truy vấn tiến độ resumable trên Google Drive' })
  videoUploadStatus(
    @Body() body: { uploadId: string },
    @Request() request: any,
  ) {
    if (!body.uploadId) throw new BadRequestException('Thiếu uploadId')
    return this.video.chunkUploadStatus(body.uploadId, request.user.id)
  }

  @Post('upload-video/chunk')
  @ApiOperation({ summary: 'Endpoint cũ đã ngừng sử dụng' })
  receiveVideoChunk() {
    throw new BadRequestException(
      'Endpoint này đã bỏ. FE upload chunk trực tiếp lên Google Drive resumable uploadUrl trả về từ /upload-video/init.',
    )
  }

  @Post('upload-video/finish')
  @ApiOperation({ summary: 'Hoàn tất upload video tạm' })
  finishVideoUpload(
    @Param('id') id: string,
    @Body() body: { uploadId: string; driveFileId?: string },
    @Request() request: any,
  ) {
    if (!body.uploadId) throw new BadRequestException('Thiếu uploadId')
    return this.video.finishChunkUpload(
      body.uploadId,
      request.user.id,
      id,
      body.driveFileId,
    )
  }

  @Get('pending-video')
  @ApiOperation({ summary: 'Stream video tạm để xem trước' })
  streamPendingVideo(@Param('id') id: string, @Res() response: Response) {
    return this.video.streamVideo(id, response)
  }
}
