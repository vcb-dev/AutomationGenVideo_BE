import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { HeldProductDto } from './dto/held-product.dto';
import { HeldSwapDto } from './dto/held-swap.dto';
import { HeldAutoDto } from './dto/held-auto.dto';
import { ScenePlacementDto } from './dto/scene-placement.dto';
import { UpdateGenerationDto } from './dto/update-generation.dto';
import { ProductImageService } from './product-image.service';
import { ProductImageGenerationsService } from './product-image-generations.service';
import { productImageUploadOptions } from './product-image-upload.util';

/**
 * Tiện ích → Tạo ảnh sản phẩm. Tạo ảnh và bấm "Đạt": mọi tài khoản đã đăng nhập (người dùng chốt
 * 2026-09-29) nên class chỉ gắn JwtAuthGuard. Riêng GET costs (tab Chi phí) chỉ ADMIN/MANAGER.
 */
@ApiTags('Product Image')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('product-image')
export class ProductImageController {
  constructor(
    private readonly productImageService: ProductImageService,
    private readonly generations: ProductImageGenerationsService,
  ) {}

  @Post('cutout')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      'Ghép background (0đ) — tách nền ảnh SP bằng rembg, trả PNG nền trong suốt đã cắt sát mép. ' +
      'FE tự dán lên ảnh phòng.',
  })
  @UseInterceptors(FileInterceptor('file', productImageUploadOptions(1)))
  async cutout(@UploadedFile() file: Express.Multer.File | undefined, @Req() req: any) {
    if (!file) {
      throw new BadRequestException('Thiếu ảnh sản phẩm (field "file")');
    }
    return this.productImageService.cutout(file, req.user);
  }

  @Post('held-product')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      'Chị Nhạm cầm SP (TỐN phí Gemini mỗi lượt) — thay SP cũ trên tay bằng SP mới. FE bắt xác ' +
      'nhận chi phí trước mỗi lần gọi.',
  })
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'personImage', maxCount: 1 },
        { name: 'productImage', maxCount: 1 },
      ],
      productImageUploadOptions(2),
    ),
  )
  async heldProduct(
    @UploadedFiles()
    files: { personImage?: Express.Multer.File[]; productImage?: Express.Multer.File[] } | undefined,
    @Body() dto: HeldProductDto,
    @Req() req: any,
  ) {
    return this.productImageService.heldProduct(
      files?.personImage?.[0],
      files?.productImage?.[0],
      { note: dto.note, productName: dto.productName },
      req.user,
    );
  }

  @Post('held-auto')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      'Chị Nhạm cầm SP — TỰ CHỌN TƯ THẾ 0đ: chỉ gửi ảnh SP mới; AI chọn các tư thế chị Nhạm hợp với dáng SP trong thư ' +
      'viện tư thế rồi ghép, trả vài ảnh để chọn. Không gọi Gemini.',
  })
  @UseInterceptors(FileInterceptor('productImage', productImageUploadOptions(1)))
  async heldAuto(@UploadedFile() productImage: Express.Multer.File | undefined, @Body() dto: HeldAutoDto, @Req() req: any) {
    return this.productImageService.heldAuto(productImage, { productName: dto.productName, widthCm: dto.widthCm }, req.user);
  }

  @Post('held-swap')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      'Chị Nhạm cầm SP — ĐỔI SP 0đ: model người cầm SP tự huấn luyện tìm SP cũ + bàn tay, xoá SP cũ, đặt SP mới ' +
      'vào tay. Không gọi Gemini, không cần xác nhận chi phí.',
  })
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'personImage', maxCount: 1 },
        { name: 'productImage', maxCount: 1 },
      ],
      productImageUploadOptions(2),
    ),
  )
  async heldSwap(
    @UploadedFiles()
    files: { personImage?: Express.Multer.File[]; productImage?: Express.Multer.File[] } | undefined,
    @Body() dto: HeldSwapDto,
    @Req() req: any,
  ) {
    return this.productImageService.heldSwap(
      files?.personImage?.[0],
      files?.productImage?.[0],
      { productName: dto.productName },
      req.user,
    );
  }

  @Post('scene-placement')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      'Đặt SP vào ảnh cảnh (TỐN phí Gemini mỗi lượt) — dùng cho tạo hàng loạt: FE gọi lần lượt từng ' +
      'SP với cùng một ảnh cảnh, xác nhận chi phí cả lô trước khi chạy.',
  })
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'productImage', maxCount: 1 },
        { name: 'sceneImage', maxCount: 1 },
      ],
      productImageUploadOptions(2),
    ),
  )
  async scenePlacement(
    @UploadedFiles()
    files: { productImage?: Express.Multer.File[]; sceneImage?: Express.Multer.File[] } | undefined,
    @Body() dto: ScenePlacementDto,
    @Req() req: any,
  ) {
    return this.productImageService.scenePlacement(
      files?.productImage?.[0],
      files?.sceneImage?.[0],
      { note: dto.note, productName: dto.productName },
      req.user,
    );
  }

  @Patch('generations/:id')
  @ApiOperation({
    summary:
      'Bấm/bỏ "Đạt" cho một ảnh Gemini đã tạo — để tính số lượt tạo và chi phí cho 1 ảnh đạt. ' +
      'Chỉ người tạo hoặc ADMIN/MANAGER.',
  })
  async setApproved(@Param('id') id: string, @Body() dto: UpdateGenerationDto, @Req() req: any) {
    return this.generations.setApproved(id, dto.approved, req.user);
  }

  @Get('gemini-estimate')
  @ApiOperation({
    summary:
      'Giá ước tính 1 ảnh Gemini (trung bình các lượt đã tính phí gần nhất) — để hộp xác nhận lô hiện ' +
      '"N ảnh, khoảng X đ". Mọi tài khoản đã đăng nhập.',
  })
  async geminiEstimate() {
    return this.generations.getGeminiEstimate();
  }

  // Chi phí chỉ ADMIN/MANAGER xem — cùng quyền với tab Chi phí của Bộ sưu tập (video-library/costs).
  // RolesGuard gắn ở handler, chạy SAU JwtAuthGuard của class nên đã có req.user.
  @Get('costs')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Tab Chi phí: tổng tiền Gemini, lượt tạo, ảnh đạt, theo ngày / sản phẩm / người' })
  @ApiQuery({ name: 'date_from', required: false, description: 'YYYY-MM-DD (giờ VN)' })
  @ApiQuery({ name: 'date_to', required: false, description: 'YYYY-MM-DD (giờ VN)' })
  async costs(@Query('date_from') dateFrom?: string, @Query('date_to') dateTo?: string) {
    return this.generations.getCostStats(dateFrom, dateTo);
  }
}
