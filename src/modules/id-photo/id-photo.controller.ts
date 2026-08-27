import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { IdPhotoService } from './id-photo.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { MergeOutfitDto, CreateIdPhotoDto, UpdateIdPhotoDto, IdPhotoHistoryQueryDto } from './dto';

/**
 * Tạo ảnh thẻ nhân viên: FE upload ảnh gốc → BE orchestrate gọi AI service (Gemini) ghép áo →
 * nhập thông tin nhân viên → xuất PDF theo khung màu (ánh xạ từ `position`). BE chỉ orchestrate,
 * không gọi thẳng Gemini API — cùng kiến trúc đã dùng cho content-transform (xem
 * AiIntegrationService#transformContent).
 *
 * Chỉ LEADER được tạo ảnh thẻ cho nhân viên; ADMIN mở thêm để hỗ trợ kỹ thuật. Không giới hạn
 * theo team — khác content-transform/history/member vốn giới hạn leader chỉ xem team mình.
 */
@ApiTags('ID Photo')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.LEADER, UserRole.ADMIN)
@Controller('id-photo')
export class IdPhotoController {
  constructor(private readonly idPhotoService: IdPhotoService) {}

  @Post('upload')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Bước 1 — upload ảnh gốc, trả về uploadId dùng cho các bước sau' })
  @UseInterceptors(
    FileInterceptor('file', {
      // MemoryStorage (mặc định khi không truyền `storage`) — giống transcribeContentTransformUpload,
      // không ghi tạm ra đĩa vì ảnh chỉ sống trong bộ nhớ tạm của IdPhotoService giữa các bước.
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB — đã chốt
      fileFilter: (_req, file, cb) => {
        const allowedMimeTypes = /^image\/(jpeg|jpg|png)$/;
        if (allowedMimeTypes.test(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new HttpException(`Chỉ chấp nhận ảnh JPG/PNG. Nhận được: ${file.mimetype}`, HttpStatus.BAD_REQUEST), false);
        }
      },
    }),
  )
  async upload(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new HttpException('Không tìm thấy file upload', HttpStatus.BAD_REQUEST);
    }
    return this.idPhotoService.uploadRawImage(file);
  }

  @Post('merge-outfit')
  @ApiOperation({ summary: 'Bước 2 — gọi AI service (Gemini) ghép áo polo đen theo prompt đã chốt' })
  async mergeOutfit(@Body() dto: MergeOutfitDto) {
    return this.idPhotoService.mergeOutfit(dto.uploadId);
  }

  @Post('create')
  @ApiOperation({ summary: 'Bước 3 — nhập thông tin nhân viên, tạo bản ghi lịch sử ảnh thẻ' })
  async create(@Req() req: any, @Body() dto: CreateIdPhotoDto) {
    return this.idPhotoService.create(req.user.id, dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Sửa thông tin trên thẻ của bản ghi đã tạo (vẫn đứng ở bước 4) — KHÔNG gọi lại AI, ' +
      'PDF dựng lại từ ảnh đã lưu trong DB',
  })
  async update(@Param('id') id: string, @Body() dto: UpdateIdPhotoDto) {
    return this.idPhotoService.update(id, dto);
  }

  @Post(':id/remerge-outfit')
  @ApiOperation({
    summary:
      'Ghép áo LẠI từ ảnh gốc đã lưu trong DB — TỐN thêm 1 lượt Gemini, chỉ gọi khi người ' +
      'dùng chủ động bấm sau khi đã được cảnh báo về chi phí',
  })
  async remergeOutfit(@Param('id') id: string) {
    return this.idPhotoService.remergeOutfit(id);
  }

  @Post(':id/export-pdf')
  @ApiOperation({ summary: 'Bước 4 — xuất PDF 1 trang, ghép ảnh vào khung màu theo position' })
  async exportPdf(@Param('id') id: string) {
    return this.idPhotoService.exportPdf(id);
  }

  @Get(':id/pdf-file')
  @ApiOperation({ summary: 'Tải file PDF đã xuất — dựng lại trực tiếp từ dữ liệu đã lưu, không đọc file trên đĩa' })
  async getPdfFile(@Param('id') id: string, @Res() res: Response) {
    const buffer = await this.idPhotoService.getPdfBuffer(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="the-nhan-vien-${id}.pdf"`);
    res.send(buffer);
  }

  @Get('history')
  @ApiOperation({ summary: 'Lấy danh sách lịch sử đã tạo (tab Lịch sử) — không giới hạn theo team' })
  async getHistory(@Query() query: IdPhotoHistoryQueryDto) {
    return this.idPhotoService.getHistory(query);
  }

  // Khai báo TRƯỚC 'history/:id'-dạng route bên dưới, cùng lý do đã ghi ở
  // ai-integration.controller.ts cho content-transform/history/team-summary. Đặt tên endpoint
  // theo ĐÚNG quy ước bên đó ('<module>/history/team-summary') để hai module nhất quán.
  //
  // MANAGER được mở thêm ở RIÊNG endpoint này (ghi đè @Roles ở cấp class — RolesGuard dùng
  // reflector.getAllAndOverride nên handler thắng class): Manager không tạo ảnh thẻ nhưng vẫn
  // cần xem thống kê toàn bộ nhân sự, giống content-transform/history/team-summary.
  @Get('history/team-summary')
  @Roles(UserRole.LEADER, UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary:
      'Tổng quan: danh sách toàn bộ thành viên trong phạm vi quyền + tổng số lượt tạo ảnh thẻ của từng người (1 lần gọi)',
  })
  async getTeamSummary(@Req() req: any) {
    return this.idPhotoService.getTeamSummary(req.user.id, req.user.roles);
  }

  // ⚠ HAI route ':id' bên dưới PHẢI đứng SAU @Get('history'). Nest so khớp route theo ĐÚNG thứ
  // tự khai báo, nên đặt @Get(':id') lên trên thì '/id-photo/history' sẽ rơi vào đây với
  // id='history' và tab Lịch sử chết ngay lập tức. (@Get(':id/pdf-file') ở trên vô hại vì nó
  // có 2 đoạn đường dẫn, không trùng dạng với '/history'.)

  @Get(':id')
  @ApiOperation({
    summary:
      'Chi tiết một bản ghi — phục vụ modal "Xem chi tiết" ở tab Lịch sử. Kèm ảnh đã ghép áo ' +
      'để FE dựng lại khung thẻ, KHÔNG kèm ảnh gốc (tối đa 10MB, modal không dùng tới).',
  })
  async getDetail(@Param('id') id: string) {
    return this.idPhotoService.getDetail(id);
  }

  @Delete(':id')
  @ApiOperation({
    summary:
      'Xoá bản ghi ảnh thẻ (hard delete, giải phóng 2 ảnh base64 trong DB). LEADER chỉ xoá ' +
      'được bản ghi do chính mình tạo; ADMIN xoá được tất cả.',
  })
  async remove(@Req() req: any, @Param('id') id: string) {
    return this.idPhotoService.remove(id, req.user);
  }
}
