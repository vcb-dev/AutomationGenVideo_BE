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
import { Public } from '../auth/decorators/public.decorator';
import {
  CreateAssetDto,
  CreateCategoryDto,
  CreateLocationDto,
  CreateModelDto,
  InspectAssetDto,
  UpdateAssetDto,
  UpdateLocationDto,
} from './dto';
import { AssetPhotoService, MEMS_PHOTO_DIR } from './asset-photo.service';
import { InspectionService } from './inspection.service';
import { MemsCatalogService } from './mems-catalog.service';

/**
 * Ai được KHAI BÁO kho: tạo danh mục, khai model, nhập máy mới.
 *
 * Manager cố ý nằm ngoài. Manager điều phối công việc hằng ngày — duyệt phiếu, kiểm tra máy trả
 * về — nhưng khai một model hay nhập một chiếc máy là chuyện tài sản: sai ở đây thì mọi phép
 * đếm khả dụng về sau lệch theo, và không bước nào phía sau bắt lại được.
 *
 * Để thành hằng số dùng chung thay vì gõ lại từng chỗ: ba endpoint này phải cùng một mức quyền,
 * mà gõ tay thì lần thêm endpoint thứ tư người ta copy nhầm dòng cũ.
 */
const CATALOG_WRITE_ROLES = [UserRole.LEADER, UserRole.ADMIN] as const;

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

  @Roles(...CATALOG_WRITE_ROLES)
  @Patch('assets/:assetCode')
  @ApiOperation({ summary: 'Sửa thông tin thiết bị — chỉ leader và admin' })
  updateAsset(@Param('assetCode') assetCode: string, @Body() dto: UpdateAssetDto) {
    return this.service.updateAsset(assetCode, dto);
  }

  @Roles(...CATALOG_WRITE_ROLES)
  @Delete('assets/:assetCode')
  @ApiOperation({ summary: 'Ngừng dùng thiết bị, xoá mềm — chỉ leader và admin' })
  deleteAsset(@Param('assetCode') assetCode: string) {
    return this.service.deleteAsset(assetCode);
  }

  @Get('assets/:assetCode/photos')
  @ApiOperation({ summary: 'Ảnh của một thiết bị' })
  listPhotos(@Param('assetCode') assetCode: string) {
    return this.photos.list(assetCode);
  }

  @Roles(UserRole.LEADER, UserRole.MANAGER, UserRole.ADMIN)
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
  @Post('photos/:photoId/primary')
  @ApiOperation({ summary: 'Chọn ảnh đại diện hiện ở bảng kho' })
  setPrimaryPhoto(@Param('photoId') photoId: string) {
    return this.photos.setPrimary(photoId);
  }

  @Roles(UserRole.LEADER, UserRole.MANAGER, UserRole.ADMIN)
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
  @Get('pending-inspection')
  @ApiOperation({ summary: 'Máy đang chờ kết luận kiểm tra (NV-14)' })
  pendingInspection() {
    return this.inspection.listPending();
  }

  @Roles(UserRole.LEADER, UserRole.MANAGER, UserRole.ADMIN)
  @Post('assets/:assetCode/inspect')
  @ApiOperation({ summary: 'Kết luận kiểm tra, đưa máy ra khỏi bàn nhận (NV-14)' })
  inspect(
    @Request() req: any,
    @Param('assetCode') assetCode: string,
    @Body() dto: InspectAssetDto,
  ) {
    return this.inspection.inspect(assetCode, req.user.id, dto);
  }

  @Roles(...CATALOG_WRITE_ROLES)
  @Post('assets')
  @ApiOperation({ summary: 'Nhập kho thiết bị mới (NV-01) — chỉ leader và admin' })
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

  @Roles(...CATALOG_WRITE_ROLES)
  @Post('models')
  @ApiOperation({ summary: 'Khai model mới kèm phụ kiện (NV-03) — chỉ leader và admin' })
  createModel(@Body() dto: CreateModelDto) {
    return this.service.createModel(dto);
  }

  @Get('locations')
  @ApiOperation({ summary: 'Vị trí lưu trữ trong kho' })
  listLocations() {
    return this.service.listLocations();
  }

  @Roles(...CATALOG_WRITE_ROLES)
  @Post('locations')
  @ApiOperation({ summary: 'Thêm vị trí lưu kho (tủ, kệ, ngăn) — chỉ leader và admin' })
  createLocation(@Body() dto: CreateLocationDto) {
    return this.service.createLocation(dto);
  }

  @Roles(...CATALOG_WRITE_ROLES)
  @Patch('locations/:id')
  @ApiOperation({ summary: 'Đổi tên hoặc chuyển chỗ một vị trí — chỉ leader và admin' })
  updateLocation(@Param('id') id: string, @Body() dto: UpdateLocationDto) {
    return this.service.updateLocation(id, dto);
  }

  @Roles(...CATALOG_WRITE_ROLES)
  @Delete('locations/:id')
  @ApiOperation({ summary: 'Ngừng dùng một vị trí, xoá mềm — chỉ leader và admin' })
  deleteLocation(@Param('id') id: string) {
    return this.service.deleteLocation(id);
  }

  @Roles(...CATALOG_WRITE_ROLES)
  @Post('categories')
  @ApiOperation({ summary: 'Tạo danh mục thiết bị (NV-02) — chỉ leader và admin' })
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.service.createCategory(dto);
  }
}
