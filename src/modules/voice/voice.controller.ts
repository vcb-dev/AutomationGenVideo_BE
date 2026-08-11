import { Controller, Post, Get, Delete, Body, Param, Query, HttpCode, HttpStatus, HttpException, Res, UseInterceptors, UploadedFile, Req, UseGuards } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiConsumes, ApiQuery } from '@nestjs/swagger';
import { VoiceService } from './voice.service';
import { AiIntegrationService } from '../ai-integration/ai-integration.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

// Khớp giới hạn của cả ba tầng: FE chặn ở ô chọn file, MiniMax từ chối file >20MB.
// Chặn ở đây để người dùng không upload xong mới nhận lỗi.
const MAX_CLONE_FILE_SIZE = 20 * 1024 * 1024;

/**
 * API giọng nói (TTS + clone giọng MiniMax) — trang Tiện ích > Clone Voice.
 *
 * Giữ nguyên prefix 'ai' (route ai/voice/*) dù đã tách module: đây là hợp đồng
 * với FE đang chạy — đổi prefix là gãy mọi client đã deploy. Tách module chỉ đổi
 * chỗ ở của code, không đổi hợp đồng.
 */
@ApiTags('Voice (MiniMax TTS + Clone)')
@Controller('ai')
export class VoiceController {
  constructor(
    private readonly voiceService: VoiceService,
    // Chỉ dùng cho translate-text: dịch kịch bản là năng lực chung (task-auto cũng
    // gọi), nằm ở AiIntegrationService — voice mượn qua DI chứ không chép lại.
    private readonly aiService: AiIntegrationService,
  ) {}

  @Get('voice/list')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'List available voices' })
  async listVoices() {
    return this.voiceService.listVoices();
  }

  // Clone chỉ có đường nền start + status. Bản đồng bộ POST voice/clone đã gỡ
  // (2026-08-07): không client nào gọi, mà giữ hai bản của cùng một luồng thì
  // sửa một bên là lệch ngay.
  @Post('voice/clone/start')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: MAX_CLONE_FILE_SIZE },
    fileFilter: (_req, file, cb) => {
      const allowedMimeTypes = /^audio\//;
      if (allowedMimeTypes.test(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new HttpException(`File type not supported: ${file.mimetype}. Only audio files allowed.`, HttpStatus.BAD_REQUEST), false);
      }
    },
  }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Start voice cloning as a background job (poll via voice/clone/status/:jobId)' })
  async cloneVoiceStart(
    @UploadedFile() file: Express.Multer.File,
    @Body('voice_name') voiceName: string,
    @Body('gender') gender?: string,
  ) {
    if (!file) {
      throw new HttpException('file is required', HttpStatus.BAD_REQUEST);
    }
    if (!voiceName) {
      throw new HttpException('voice_name is required', HttpStatus.BAD_REQUEST);
    }
    return this.voiceService.cloneVoiceStart(file, voiceName, gender);
  }

  @Get('voice/clone/status/:jobId')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Poll status of a background voice-clone job' })
  async cloneVoiceStatus(@Param('jobId') jobId: string, @Req() req: any) {
    return this.voiceService.cloneVoiceStatus(jobId, req.user?.id);
  }

  @Delete('voice/:voiceId')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Xoá một giọng đã clone (xoá cả trên MiniMax lẫn DB)' })
  async deleteClonedVoice(@Param('voiceId') voiceId: string) {
    if (!voiceId) {
      throw new HttpException('voiceId is required', HttpStatus.BAD_REQUEST);
    }
    return this.voiceService.deleteClonedVoice(voiceId);
  }

  @Get('voice/usage/stats')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Voice usage stats (điểm TTS + số clone), tổng và theo từng user' })
  @ApiQuery({ name: 'date_from', required: false, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'date_to', required: false, description: 'YYYY-MM-DD' })
  async voiceUsageStats(
    @Query('date_from') dateFrom?: string,
    @Query('date_to') dateTo?: string,
  ) {
    return this.voiceService.getVoiceUsageStats(dateFrom, dateTo);
  }

  // KHÔNG gắn JwtAuthGuard: thẻ <audio src> của trình duyệt không gửi được JWT
  // header. Service tự giới hạn chỉ stream file TTS (tts_*.mp3, mimeType audio/*).
  @Get('voice/tts/audio/:fileId')
  @ApiOperation({ summary: 'Stream/tải file TTS audio từ Drive qua BE (?download=1 để tải về, ?filename= đặt tên file tải)' })
  async streamTtsAudio(
    @Param('fileId') fileId: string,
    @Req() req: any,
    @Res() res: Response,
    @Query('download') download?: string,
    @Query('filename') filename?: string,
  ) {
    return this.voiceService.streamTtsAudio(
      fileId,
      res,
      download === '1' || download === 'true',
      req.headers?.['range'],
      filename,
    );
  }

  // KHÔNG gắn JwtAuthGuard: thẻ <audio src> không gửi được JWT header (giống
  // voice/tts/audio/:fileId). Service whitelist tên file tts_<hex32>.mp3.
  // Fallback khi Drive chưa cấu hình — stream file TTS thẳng từ AI service.
  @Get('voice/tts/stream/:filename')
  @ApiOperation({ summary: 'Stream/tải file TTS từ AI service khi chưa có Drive (?download=1, ?filename= đặt tên file tải)' })
  async streamTtsAudioFromAi(
    @Param('filename') filename: string,
    @Req() req: any,
    @Res() res: Response,
    @Query('download') download?: string,
    @Query('filename') downloadName?: string,
  ) {
    return this.voiceService.streamTtsAudioFromAi(
      filename,
      res,
      download === '1' || download === 'true',
      downloadName,
      req.headers?.['range'],
    );
  }

  @Post('voice/tts')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Convert text to speech using Minimax' })
  async generateTTS(
    @Body('text') text: string,
    @Body('voice_id') voiceId: string,
    @Req() req: any,
    @Body('speed') speed?: number,
    @Body('pitch') pitch?: number,
    @Body('volume') volume?: number,
    @Body('language') language?: string,
  ) {
    if (!text) {
      throw new HttpException('text is required', HttpStatus.BAD_REQUEST);
    }
    if (!voiceId) {
      throw new HttpException('voice_id is required', HttpStatus.BAD_REQUEST);
    }
    return this.voiceService.generateTTS(text, voiceId, speed, pitch, volume, language, req.user?.id);
  }

  @Post('voice/translate-text')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Dịch văn bản (trang Clone Voice) sang một ngôn ngữ đã chọn, dùng lại AI dịch kịch bản video' })
  async translateVoiceText(
    @Body('text') text: string,
    @Body('language') language: string,
  ) {
    if (!text) {
      throw new HttpException('text is required', HttpStatus.BAD_REQUEST);
    }
    if (!language) {
      throw new HttpException('language is required', HttpStatus.BAD_REQUEST);
    }
    return this.aiService.translateVideoScript({ content: text, hashtags: [], language });
  }
}
