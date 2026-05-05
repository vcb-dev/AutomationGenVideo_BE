import { Controller, Get, Param, Req, Res, NotFoundException } from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '../../../common/prisma/prisma.service';
import * as path from 'path';
import * as fs from 'fs';

const UPLOAD_DIR = process.env.SOCIAL_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'social');

const MIME_MAP: Record<string, string> = {
  '.mp4':  'video/mp4',
  '.mov':  'video/quicktime',
  '.avi':  'video/x-msvideo',
  '.mkv':  'video/x-matroska',
  '.webm': 'video/webm',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
};

@ApiTags('Social Media Serve')
@Controller('social/media')
export class MediaController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':filename')
  @ApiOperation({ summary: 'Serve media file — từ disk (đang upload) hoặc DB (đã đăng xong)' })
  async serveFile(@Param('filename') filename: string, @Req() req: Request, @Res() res: Response) {
    const safeName = path.basename(filename);
    const filePath = path.join(UPLOAD_DIR, safeName);

    // Ưu tiên serve từ disk (file đang trong quá trình upload/posting)
    if (fs.existsSync(filePath)) {
      return this.serveFromDisk(filePath, safeName, req, res);
    }

    // Fallback: serve từ database (file đã được lưu sau khi đăng xong)
    const mediaFile = await this.prisma.socialMediaFile.findUnique({
      where: { filename: safeName },
      select: { data: true, mimetype: true, size: true },
    });

    if (!mediaFile) throw new NotFoundException('File không tồn tại');

    return this.serveFromBuffer(Buffer.from(mediaFile.data), mediaFile.mimetype, mediaFile.size, req, res);
  }

  private serveFromDisk(filePath: string, safeName: string, req: Request, res: Response) {
    const ext = path.extname(safeName).toLowerCase();
    const contentType = MIME_MAP[ext] || 'application/octet-stream';
    const fileSize = fs.statSync(filePath).size;

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('ngrok-skip-browser-warning', 'true');
    res.setHeader('Content-Type', contentType);
    res.setHeader('Accept-Ranges', 'bytes');

    const rangeHeader = req.headers['range'];

    if (rangeHeader) {
      const match = (rangeHeader as string).match(/^bytes=(\d+)-(\d*)$/);
      if (!match) {
        res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
        return;
      }
      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
      if (start >= fileSize || end >= fileSize || start > end) {
        res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
        return;
      }
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      res.setHeader('Content-Length', end - start + 1);
      res.status(206);
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.setHeader('Content-Length', fileSize);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.status(200);
      fs.createReadStream(filePath).pipe(res);
    }
  }

  private serveFromBuffer(buffer: Buffer, contentType: string, size: number, req: Request, res: Response) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('ngrok-skip-browser-warning', 'true');
    res.setHeader('Content-Type', contentType);
    res.setHeader('Accept-Ranges', 'bytes');

    const rangeHeader = req.headers['range'];

    if (rangeHeader) {
      const match = (rangeHeader as string).match(/^bytes=(\d+)-(\d*)$/);
      if (!match) {
        res.status(416).setHeader('Content-Range', `bytes */${size}`).end();
        return;
      }
      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : size - 1;
      if (start >= size || end >= size || start > end) {
        res.status(416).setHeader('Content-Range', `bytes */${size}`).end();
        return;
      }
      const chunk = buffer.subarray(start, end + 1);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      res.setHeader('Content-Length', chunk.length);
      res.status(206).send(chunk);
    } else {
      res.setHeader('Content-Length', size);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.status(200).send(buffer);
    }
  }
}
