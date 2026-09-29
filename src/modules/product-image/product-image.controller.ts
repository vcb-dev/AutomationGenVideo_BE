import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Req,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { HeldProductDto } from './dto/held-product.dto';
import { ProductImageService } from './product-image.service';
import { productImageUploadOptions } from './product-image-upload.util';

/**
 * Tiện ích → Tạo ảnh sản phẩm. Mọi tài khoản đã đăng nhập đều dùng được (người dùng chốt
 * 2026-09-29) nên chỉ cần JwtAuthGuard, không có @Roles.
 */
@ApiTags('Product Image')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('product-image')
export class ProductImageController {
  constructor(private readonly productImageService: ProductImageService) {}

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
      dto.note,
      req.user,
    );
  }
}
