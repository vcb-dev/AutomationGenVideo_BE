import { Controller, Get, Param, Res, NotFoundException } from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import * as fs from 'fs';
import { AvatarService } from './avatar.service';

/**
 * Không đặt guard, giống MediaController: thẻ <img> không gửi được header
 * Authorization. Đường dẫn dùng UUID của tài khoản nên không dò tuần tự được,
 * và nội dung chỉ là ảnh đại diện vốn công khai trên chính mạng xã hội đó.
 */
@ApiTags('Social Account Avatar')
@Controller('social/accounts')
export class AvatarController {
  constructor(private readonly avatar: AvatarService) {}

  @Get(':id/avatar')
  @ApiOperation({ summary: 'Phục vụ ảnh đại diện kênh, tự lấy lại khi URL của Meta hết hạn' })
  async serve(@Param('id') id: string, @Res() res: Response) {
    const filePath = await this.avatar.resolveAvatarFile(id);
    if (!filePath) {
      // Giao diện đã có sẵn phần hiển thị chữ cái đầu khi thiếu ảnh.
      throw new NotFoundException('Không lấy được ảnh đại diện');
    }

    res.setHeader('Content-Type', 'image/jpeg');
    // Cho trình duyệt giữ một ngày — lần vào trang sau gần như không gọi lại backend.
    res.setHeader('Cache-Control', 'public, max-age=86400');
    fs.createReadStream(filePath).pipe(res);
  }
}
