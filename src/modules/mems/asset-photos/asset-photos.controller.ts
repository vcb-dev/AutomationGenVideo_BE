import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Request,
  Res,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { MemsMediaLeaderGuard } from '../../../common/guards/mems-media-leader.guard';
import { MulterErrorFilter } from '../../../common/mems/multer-error.filter';
import { MemsPhotoUrlSigner } from '../../../common/mems/photo-url-signer.service';
import { Public } from '../../auth/decorators/public.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { AssetPhotoService, MEMS_PHOTO_DIR, MEMS_PHOTO_MAX_BYTES, PHOTO_PURPOSE } from './asset-photo.service';

@ApiTags('MEMS — Kho thiết bị')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('mems')
export class MemsAssetPhotosController {
  constructor(
    private readonly photos: AssetPhotoService,
    private readonly photoUrls: MemsPhotoUrlSigner,
  ) {}

  @Get('assets/:assetCode/photos')
  @ApiOperation({ summary: 'Ảnh của một thiết bị' })
  listPhotos(@Param('assetCode') assetCode: string) {
    return this.photos.list(assetCode);
  }

  @Roles(UserRole.LEADER, UserRole.MANAGER, UserRole.ADMIN)
  @UseGuards(MemsMediaLeaderGuard)
  @Post('assets/:assetCode/photos')
  @ApiOperation({ summary: 'Tải ảnh thiết bị lên' })
  @ApiConsumes('multipart/form-data')
  // Trần kích thước phải đặt ở ĐÂY chứ không chỉ trong service: Multer nạp trọn file vào RAM
  // trước khi tầng service chạy, nên kiểm sau là đã muộn. Đổi lại, lỗi vượt trần giờ do Multer
  // ném ra chứ không phải service — mà `MulterError` không phải `HttpException` nên filter toàn
  // cục xếp vào 500. `MulterErrorFilter` dịch lại thành 400 kèm câu nhắc bằng tiếng Việt.
  @UseFilters(MulterErrorFilter)
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: MEMS_PHOTO_MAX_BYTES } }))
  uploadPhoto(
    @Request() req: any,
    @Param('assetCode') assetCode: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('caption') caption?: string,
    @Body('purpose') purpose?: string,
  ) {
    // Giá trị lạ quy về ảnh hồ sơ thay vì ném lỗi: đây là trường phụ, chặn cứng nó sẽ làm hỏng
    // cả lượt bàn giao chỉ vì một chữ viết sai.
    const safePurpose =
      purpose === PHOTO_PURPOSE.HANDOVER || purpose === PHOTO_PURPOSE.RETURN
        ? purpose
        : PHOTO_PURPOSE.CATALOG;
    return this.photos.upload(assetCode, req.user.id, file, caption, req.user, safePurpose);
  }

  /** Cố ý không có @Roles: người mượn nào cũng phải đính kèm được ảnh vào phiếu của mình. */
  @Post('request-photos')
  @ApiOperation({ summary: 'Tải ảnh người mượn đính kèm phiếu hoặc báo sự cố' })
  @ApiConsumes('multipart/form-data')
  @UseFilters(MulterErrorFilter)
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: MEMS_PHOTO_MAX_BYTES } }))
  uploadRequestPhoto(@Request() req: any, @UploadedFile() file: Express.Multer.File) {
    return this.photos.uploadRequestPhoto(req.user.id, file, req.user);
  }

  @Roles(UserRole.LEADER, UserRole.MANAGER, UserRole.ADMIN)
  @UseGuards(MemsMediaLeaderGuard)
  @Post('photos/:photoId/primary')
  @ApiOperation({ summary: 'Chọn ảnh đại diện hiện ở bảng kho' })
  setPrimaryPhoto(@Param('photoId') photoId: string) {
    return this.photos.setPrimary(photoId);
  }

  @Roles(UserRole.LEADER, UserRole.MANAGER, UserRole.ADMIN)
  @UseGuards(MemsMediaLeaderGuard)
  @Delete('photos/:photoId')
  @ApiOperation({ summary: 'Xoá một ảnh thiết bị' })
  removePhoto(@Param('photoId') photoId: string) {
    return this.photos.remove(photoId);
  }

  /**
   * Công khai có chủ đích: thẻ <img> của trình duyệt không gửi được header Authorization,
   * nên để sau JwtAuthGuard thì ảnh không bao giờ hiện lên.
   *
   * Đổi lại phải tự canh cửa: tên file chỉ nhận đúng dạng do chính server sinh ra
   * (MÃMÁY_mốcthờigian_ngẫunhiên.đuôi), nên không ai đoán được đường dẫn để dò, và cũng không
   * ai chèn được ../ để đọc file khác trên máy chủ.
   */
  @Public()
  @Get('photos/:filename')
  @ApiOperation({ summary: 'Phục vụ ảnh lưu trên đĩa khi chưa cấu hình Google Drive' })
  servePhoto(
    @Param('filename') filename: string,
    @Res() res: Response,
    @Query('t') token?: string,
  ) {
    const safeName = path.basename(filename);
    if (!/^[A-Za-z0-9-]+_\d{10,}_[a-z0-9]{4,12}\.(jpg|jpeg|png|gif|webp|heic)$/i.test(safeName)) {
      throw new NotFoundException('Không tìm thấy ảnh');
    }
    // Chữ ký là thứ DUY NHẤT còn canh cửa ở đây, vì route buộc phải công khai. Trả 404 chứ không
    // 403: 403 xác nhận file có tồn tại, tức là vẫn rò rỉ một mẩu thông tin cho người đang dò.
    if (!this.photoUrls.verify(safeName, token)) {
      throw new NotFoundException('Không tìm thấy ảnh');
    }
    const filePath = path.join(MEMS_PHOTO_DIR, safeName);
    if (!fs.existsSync(filePath)) throw new NotFoundException('Không tìm thấy ảnh');
    const mime: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.heic': 'image/heic',
    };
    res.setHeader('Content-Type', mime[path.extname(safeName).toLowerCase()] || 'application/octet-stream');
    // `private`: chỉ trình duyệt của người xem được giữ bản sao. Trước đây là `public`, nghĩa là
    // mọi proxy hay CDN trên đường đi đều được phép lưu và phục vụ lại ảnh serial thiết bị.
    res.setHeader('Cache-Control', 'private, max-age=604800');
    fs.createReadStream(filePath).pipe(res);
  }
}
