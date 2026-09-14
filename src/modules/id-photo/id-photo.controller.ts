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
import { IdPhotoBatchService } from './id-photo-batch.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  MergeOutfitDto,
  CreateIdPhotoDto,
  CreateIdPhotoBatchDto,
  UpdateIdPhotoDto,
  IdPhotoHistoryQueryDto,
} from './dto';

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
  constructor(
    private readonly idPhotoService: IdPhotoService,
    private readonly idPhotoBatchService: IdPhotoBatchService,
  ) {}

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

  // ═══════════════════════════════════════════════════════════════
  // Tạo ảnh thẻ HÀNG LOẠT — job cha + worker nền tuần tự. FE: upload từng ảnh gốc qua
  // POST /id-photo/upload để lấy uploadId, rồi gọi POST /id-photo/batch với danh sách.
  //
  // 3 route 'batch*' này khai báo TRƯỚC @Get(':id')/@Patch(':id')/@Delete(':id') — 'batch'
  // và 'batch/:x/...' đều không trùng dạng ':id' một đoạn nên vô hại về thứ tự, nhưng gom lên
  // đây cho dễ đọc cùng nhóm.
  // ═══════════════════════════════════════════════════════════════

  @Post('batch')
  @ApiOperation({
    summary:
      'Tạo ảnh thẻ hàng loạt (tối đa 20 người) — tạo job cha + N bản ghi con PENDING, trả ' +
      'batchJobId NGAY, worker nền xử lý tuần tự sau đó. Poll qua GET /id-photo/batch/:batchJobId.',
  })
  async createBatch(@Req() req: any, @Body() dto: CreateIdPhotoBatchDto) {
    return this.idPhotoBatchService.createBatch(req.user.id, dto);
  }

  @Get('batch/:batchJobId')
  @ApiOperation({
    summary:
      'Trạng thái job hàng loạt: trạng thái tổng job cha + mảng trạng thái từng người con ' +
      '(PENDING/PROCESSING/SUCCESS/FAILED) đủ để FE vẽ lại lưới ảnh.',
  })
  async getBatchStatus(@Param('batchJobId') batchJobId: string) {
    return this.idPhotoBatchService.getBatchStatus(batchJobId);
  }

  @Post('batch/:batchJobId/export-pdf')
  @ApiOperation({
    summary:
      'Xuất 1 file PDF GỘP: mỗi người SUCCESS trong batch = 1 trang (khổ CR80), bỏ qua người ' +
      'FAILED / chưa có ảnh. Header X-Exported-Count / X-Total-Count / X-Skipped-Count.',
  })
  async exportBatchPdf(@Param('batchJobId') batchJobId: string, @Res() res: Response) {
    // BẮT lỗi NGAY TRONG handler: route này dùng @Res() nên nếu để exception lọt ra ngoài thì
    // Express default error handler xử lý — và nó KHÔNG kèm header CORS mà `cors` middleware đã
    // gắn lên `res`. Trình duyệt khi đó chỉ thấy "No Access-Control-Allow-Origin" / "Failed to
    // fetch" thay vì message lỗi thật (vd DB chậm lúc kéo ~10MB ảnh của 5 người). Tự trả JSON
    // lỗi ở đây thì `res` vẫn còn nguyên ACAO → FE đọc được và hiện đúng lý do + cho thử lại.
    try {
      const { buffer, exported, total, skipped } = await this.idPhotoBatchService.exportBatchPdf(batchJobId);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="anh-the-hang-loat-${batchJobId}.pdf"`);
      res.setHeader('X-Exported-Count', String(exported));
      res.setHeader('X-Total-Count', String(total));
      res.setHeader('X-Skipped-Count', String(skipped));
      // Cho phép FE (khác origin) đọc được 3 header đếm ở trên để hiện "Đã xuất X/N".
      res.setHeader('Access-Control-Expose-Headers', 'X-Exported-Count, X-Total-Count, X-Skipped-Count');
      res.send(buffer);
    } catch (err: any) {
      if (res.headersSent) {
        res.end();
        return;
      }
      const status =
        err instanceof HttpException ? err.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
      const body = err instanceof HttpException ? err.getResponse() : null;
      const message =
        (body && typeof body === 'object' && 'message' in body ? (body as any).message : null) ||
        err?.message ||
        'Không dựng được PDF hàng loạt, vui lòng thử lại.';
      res.status(status).json({ statusCode: status, message });
    }
  }

  @Post('batch/:batchJobId/retry/:historyId')
  @ApiOperation({
    summary: 'Thử lại ĐÚNG 1 người bị LỖI (FAILED) trong job hàng loạt — không chạy lại cả batch.',
  })
  async retryBatchPerson(
    @Param('batchJobId') batchJobId: string,
    @Param('historyId') historyId: string,
  ) {
    return this.idPhotoBatchService.retryPerson(batchJobId, historyId);
  }

  @Post('batch/:batchJobId/remerge/:historyId')
  @ApiOperation({
    summary:
      'Ghép áo LẠI cho ĐÚNG 1 người đã SUCCESS (ảnh AI không ưng ý — vd đỉnh đầu bị cắt). ' +
      'TỐN 1 lượt Gemini, FE bắt xác nhận trước. Chạy lại đủ ghép áo → ghép khung → PDF.',
  })
  async remergeBatchPerson(
    @Param('batchJobId') batchJobId: string,
    @Param('historyId') historyId: string,
  ) {
    return this.idPhotoBatchService.remergePerson(batchJobId, historyId);
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
