import { Controller, Get, Res, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Response } from 'express';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const EXT_DIR = join(process.cwd(), 'public', 'extension');

@ApiTags('Extension')
@Controller('extension')
export class ExtensionController {
  @Get('updates.xml')
  @ApiOperation({ summary: 'Chrome extension update manifest (dùng để force-install qua policy)' })
  updateManifest(@Res() res: Response) {
    const file = join(EXT_DIR, 'updates.xml');
    if (!existsSync(file)) throw new NotFoundException('updates.xml chưa được deploy');
    const content = readFileSync(file);
    res.set('Content-Type', 'application/xml');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(content);
  }

  @Get('extension.crx')
  @ApiOperation({ summary: 'Chrome extension CRX package' })
  extensionCrx(@Res() res: Response) {
    const file = join(EXT_DIR, 'extension.crx');
    if (!existsSync(file)) throw new NotFoundException('extension.crx chưa được deploy');
    const content = readFileSync(file);
    res.set('Content-Type', 'application/x-chrome-extension');
    res.set('Content-Disposition', 'attachment; filename="vcb-tiktok-clone.crx"');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(content);
  }
}
