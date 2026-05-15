import { Controller, Get, Param, Req, Res, NotFoundException } from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import * as path from 'path';
import * as fs from 'fs';

const UPLOAD_DIR = process.env.SOCIAL_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'social');

const MIME_MAP: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

@ApiTags('Social Media Serve')
@Controller('social/media')
export class MediaController {
  @Get(':filename')
  @ApiOperation({ summary: 'Serve temporary local media file' })
  async serveFile(@Param('filename') filename: string, @Req() req: Request, @Res() res: Response) {
    const safeName = path.basename(filename);
    const filePath = path.join(UPLOAD_DIR, safeName);

    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('File khong ton tai');
    }

    return this.serveFromDisk(filePath, safeName, req, res);
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
}
