import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Request,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes } from '@nestjs/swagger';
import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { MemsMediaLeaderGuard } from '../../common/guards/mems-media-leader.guard';
import { Public } from '../auth/decorators/public.decorator';
import { CreateAssetDto, CreateCategoryDto, CreateLocationDto, CreateModelDto, InspectAssetDto, UpdateAssetDto, UpdateLocationDto } from './dto';
import { AssetPhotoService, MEMS_PHOTO_DIR } from './asset-photo.service';
import { InspectionService } from './inspection.service';
import { MemsCatalogService } from './mems-catalog.service';

@ApiTags('MEMS — Kho thiết bị')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('mems')
export class MemsCatalogController {
  constructor(
    private readonly service: MemsCatalogService,
    private readonly inspection: InspectionService,
    private readonly photos: AssetPhotoService,
  ) {}

  @Get('assets')
  @ApiOperation({ summary: 'Danh sách thiết bị trong kho (MH-02)' })
  listAssets(@Query('categoryId') categoryId?: string, @Query('status') status?: string) {
    return this.service.listAssets({ categoryId, status });
  }

  @Get('assets/:assetCode')
  @ApiOperation({ summary: 'Chi tiết thiết bị kèm nhật ký vòng đời (MH-03)' })
  assetDetail(@Param('assetCode') assetCode: string) {
    return this.service.assetDetail(assetCode);
  }

  @Roles(UserRole.LEADER, UserRole.MANAGER, UserRole.ADMIN)
  @UseGuards(MemsMediaLeaderGuard)
  @Patch('assets/:assetCode')
  @ApiOperation({ summary: 'Chỉnh sửa thông tin thiết bị' })
  updateAsset(@Param('assetCode') assetCode: string, @Body() dto: UpdateAssetDto) {
    return this.service.updateAsset(assetCode, dto);
  }

  @Roles(UserRole.LEADER, UserRole.MANAGER, UserRole.ADMIN)
  @UseGuards(MemsMediaLeaderGuard)
  @Delete('assets/:assetCode')
  @ApiOperation({ summary: 'Xóa thiết bị khỏi kho' })
  deleteAsset(@Param('assetCode') assetCode: string) {
    return this.service.deleteAsset(assetCode);
  }

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
  @UseInterceptors(FileInterceptor('photo'))
  uploadPhoto(
    @Request() req: any,
    @Param('assetCode') assetCode: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('caption') caption?: string,
  ) {
    return this.photos.upload(assetCode, req.user.id, file, caption, req.user);
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
  servePhoto(@Param('filename') filename: string, @Res() res: Response) {
    const safeName = path.basename(filename);
    if (!/^[A-Za-z0-9-]+_\d{10,}_[a-z0-9]{4,12}\.(jpg|jpeg|png|gif|webp|heic)$/i.test(safeName)) {
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
    res.setHeader('Cache-Control', 'public, max-age=604800');
    fs.createReadStream(filePath).pipe(res);
  }

  @Roles(UserRole.LEADER, UserRole.MANAGER, UserRole.ADMIN)
  @UseGuards(MemsMediaLeaderGuard)
  @Get('pending-inspection')
  @ApiOperation({ summary: 'Máy đang chờ kết luận kiểm tra (NV-14)' })
  pendingInspection() {
    return this.inspection.listPending();
  }

  @Roles(UserRole.LEADER, UserRole.MANAGER, UserRole.ADMIN)
  @UseGuards(MemsMediaLeaderGuard)
  @Post('assets/:assetCode/inspect')
  @ApiOperation({ summary: 'Kết luận kiểm tra, đưa máy ra khỏi bàn nhận (NV-14)' })
  inspect(
    @Request() req: any,
    @Param('assetCode') assetCode: string,
    @Body() dto: InspectAssetDto,
  ) {
    return this.inspection.inspect(assetCode, req.user.id, dto);
  }

  @Roles(UserRole.LEADER, UserRole.MANAGER, UserRole.ADMIN)
  @UseGuards(MemsMediaLeaderGuard)
  @Post('assets')
  @ApiOperation({ summary: 'Nhập kho thiết bị mới (NV-01)' })
  createAsset(@Body() dto: CreateAssetDto) {
    return this.service.createAsset(dto);
  }

  @Get('categories')
  @ApiOperation({ summary: 'Danh mục thiết bị, cho dropdown form nhập kho' })
  listCategories() {
    return this.service.listCategories();
  }

  @Get('models')
  @ApiOperation({ summary: 'Danh sách model, kèm phụ kiện và số máy đang có' })
  listModels(@Query('categoryId') categoryId?: string) {
    return this.service.listModels({ categoryId });
  }

  @Roles(UserRole.LEADER, UserRole.MANAGER, UserRole.ADMIN)
  @UseGuards(MemsMediaLeaderGuard)
  @Post('models')
  @ApiOperation({ summary: 'Khai model mới kèm phụ kiện (NV-03)' })
  createModel(@Body() dto: CreateModelDto) {
    return this.service.createModel(dto);
  }

  @Get('locations')
  @ApiOperation({ summary: 'Vị trí lưu trữ trong kho' })
  listLocations() {
    return this.service.listLocations();
  }

  @Roles(UserRole.LEADER, UserRole.MANAGER, UserRole.ADMIN)
  @UseGuards(MemsMediaLeaderGuard)
  @Post('locations')
  @ApiOperation({ summary: 'Tạo vị trí lưu kho mới (Tủ/Kệ/Ngăn)' })
  createLocation(@Body() dto: CreateLocationDto) {
    return this.service.createLocation(dto);
  }

  @Roles(UserRole.LEADER, UserRole.MANAGER, UserRole.ADMIN)
  @UseGuards(MemsMediaLeaderGuard)
  @Patch('locations/:id')
  @ApiOperation({ summary: 'Sửa tên vị trí lưu kho' })
  updateLocation(@Param('id') id: string, @Body() dto: UpdateLocationDto) {
    return this.service.updateLocation(id, dto);
  }

  @Roles(UserRole.LEADER, UserRole.MANAGER, UserRole.ADMIN)
  @UseGuards(MemsMediaLeaderGuard)
  @Delete('locations/:id')
  @ApiOperation({ summary: 'Xóa/ngừng dùng vị trí lưu kho' })
  deleteLocation(@Param('id') id: string) {
    return this.service.deleteLocation(id);
  }

  @Roles(UserRole.LEADER, UserRole.MANAGER, UserRole.ADMIN)
  @UseGuards(MemsMediaLeaderGuard)
  @Post('categories')
  @ApiOperation({ summary: 'Tạo danh mục thiết bị (NV-02)' })
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.service.createCategory(dto);
  }
}
