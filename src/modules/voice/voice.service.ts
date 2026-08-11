import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom, catchError } from 'rxjs';
import { AxiosError } from 'axios';
import { PrismaService } from '../../common/prisma/prisma.service';
import { GoogleDriveStorageService } from '../social-publishing/upload/google-drive-storage.service';

/**
 * Toàn bộ nghiệp vụ giọng nói (TTS + clone giọng MiniMax) — tách khỏi
 * AiIntegrationService (2026-08-07) vì trước đó nó trộn chung với search/mix
 * video/PAAST trong một service 2600 dòng.
 *
 * Luồng: FE → BE (module này) → AI service (Django) → MiniMax.
 * BE là lớp proxy + ghi log tiêu dùng + đưa audio lên Drive; KHÔNG gọi thẳng
 * MiniMax — key MiniMax gửi sang AI qua header X-Minimax-Key từng request.
 *
 * KHÔNG có URL nào trong file này (kể cả localhost) — quy ước riêng của module,
 * chốt bằng __tests__/voice-config-required.spec.ts. Mọi giá trị nằm ở .env:
 *   AI_SERVICE_URL                — bắt buộc (local dev dùng chung với các module khác)
 *   AI_SERVICE_VOICE_RAILWAY_URL  — bắt buộc khi BE chạy trên Railway
 *   AI_SERVICE_URL_VOICE          — override thủ công, thắng tất cả
 *   MINIMAX_API_KEY               — key giữ ở BE, không nằm ở .env của AI
 *   MINIMAX_VND_PER_1K_CHARS      — đơn giá quy đổi điểm ra tiền (0 = FE ẩn phần tiền)
 */
@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);
  /**
   * URL cho các endpoint /api/voice/* bên AI. Các endpoint này chỉ gọi API cloud
   * MiniMax, không cần torch/GPU/NAS — nên deploy được thẳng trên Railway, khác
   * với AI_SERVICE_URL chung (trỏ máy local qua Cloudflare Tunnel cho các tính
   * năng cần torch/NAS). Rỗng = chưa cấu hình → mọi endpoint trả 503 qua baseUrl().
   */
  private readonly voiceAiServiceUrl: string;
  private readonly minimaxApiKey?: string;
  /**
   * Đơn giá quy đổi "điểm âm thanh" MiniMax ra tiền: VND cho mỗi 1000 ký tự tính
   * phí. Để 0 nếu chưa biết giá — FE sẽ ẩn phần hiển thị tiền.
   */
  private readonly minimaxVndPer1kChars: number;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly driveStorage: GoogleDriveStorageService,
  ) {
    const aiServiceUrl = this.configService.get<string>('AI_SERVICE_URL') ?? '';
    // Trên Railway voice nên đi qua Private Networking sang service AI. Cổng do
    // Railway cấp qua ${PORT} (Dockerfile.railway) nên không suy ra được từ repo —
    // vì thế bắt khai AI_SERVICE_VOICE_RAILWAY_URL thay vì đoán sẵn trong code.
    const runningOnRailway = !!this.configService.get<string>('RAILWAY_ENVIRONMENT_NAME');
    const railwayVoiceUrl = this.configService.get<string>('AI_SERVICE_VOICE_RAILWAY_URL') ?? '';
    if (runningOnRailway && !railwayVoiceUrl) {
      this.logger.warn(
        'Đang chạy trên Railway nhưng chưa khai AI_SERVICE_VOICE_RAILWAY_URL — voice sẽ đi qua ' +
        'AI_SERVICE_URL (tunnel máy local, có thể đang tắt). Set biến này bằng private domain ' +
        'của service AI, VD http://<service>.railway.internal:<PORT>.',
      );
    }
    this.voiceAiServiceUrl =
      this.configService.get<string>('AI_SERVICE_URL_VOICE') ||
      (runningOnRailway && railwayVoiceUrl) ||
      aiServiceUrl ||
      '';
    this.minimaxApiKey = this.configService.get<string>('MINIMAX_API_KEY');
    this.minimaxVndPer1kChars =
      Number(this.configService.get<string>('MINIMAX_VND_PER_1K_CHARS', '0')) || 0;

    if (!this.voiceAiServiceUrl) {
      this.logger.warn(
        'AI_SERVICE_URL / AI_SERVICE_URL_VOICE chưa được cấu hình — mọi endpoint voice sẽ trả 503. Xem .env.example.',
      );
    } else {
      this.logger.log(`Voice AI Service URL: ${this.voiceAiServiceUrl}`);
    }
    if (!this.minimaxApiKey) {
      this.logger.warn(
        'MINIMAX_API_KEY chưa được set — TTS/clone giọng sẽ lỗi (key giữ ở BE, gửi sang AI qua header X-Minimax-Key)',
      );
    }
  }

  /**
   * Một cửa kiểm duy nhất cho mọi lời gọi sang AI: thiếu cấu hình thì hỏng TO với
   * đúng tên biến cần khai, không âm thầm gọi vào một địa chỉ đoán mò.
   */
  private baseUrl(): string {
    if (!this.voiceAiServiceUrl) {
      throw new HttpException(
        'Voice chưa được cấu hình: khai AI_SERVICE_URL (local) hoặc AI_SERVICE_VOICE_RAILWAY_URL (Railway) trong .env — xem .env.example.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return this.voiceAiServiceUrl;
  }

  /**
   * Key MiniMax giữ ở .env của BE và gửi kèm từng request voice sang AI service
   * qua header X-Minimax-Key — AI không còn giữ key trong .env của nó.
   */
  private minimaxHeaders(): Record<string, string> {
    return this.minimaxApiKey ? { 'X-Minimax-Key': this.minimaxApiKey } : {};
  }

  /** Get available voices, including custom cloned ones and system ones. */
  async listVoices(): Promise<any> {
    const url = `${this.baseUrl()}/api/voice/list/`;
    this.logger.log(`Calling AI Service: GET ${url}`);
    try {
      const { data } = await firstValueFrom(
        this.httpService.get(url).pipe(
          catchError((error: AxiosError) => {
            this.logger.error(`AI Service error listing voices: ${error.message}`);
            throw new HttpException(
              error.response?.data || 'Failed to list voices',
              error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
            );
          }),
        ),
      );
      // Kèm đơn giá để FE hiển thị ước tính tiền ngay tại ô nhập kịch bản
      if (data && typeof data === 'object') {
        data.pricing = { vnd_per_1k_chars: this.minimaxVndPer1kChars };
      }
      return data;
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(error.message || 'Failed to list voices', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Start voice cloning as a background job on the AI service (returns job_id
   * immediately). Mạng tới api MiniMax có thể chập chờn vài phút — clone đồng bộ
   * (một request chờ tới khi xong) dễ khiến FE/BE tự timeout dù MiniMax cuối
   * cùng vẫn xử lý xong. Dùng cloneVoiceStatus() để poll kết quả.
   */
  async cloneVoiceStart(file: any, voiceName: string, gender = 'female'): Promise<any> {
    const FormData = require('form-data');
    const url = `${this.baseUrl()}/api/voice/clone/start/`;
    this.logger.log(`Calling AI Service: POST ${url} for voiceName=${voiceName}`);

    try {
      const formData = new FormData();
      formData.append('file', file.buffer, {
        filename: file.originalname,
        contentType: file.mimetype,
      });
      formData.append('voice_name', voiceName);
      formData.append('gender', gender || 'female');

      const { data } = await firstValueFrom(
        this.httpService.post(url, formData, {
          headers: { ...formData.getHeaders(), ...this.minimaxHeaders() },
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
          // Chỉ upload file + spawn job nền trên AI service, không chờ clone
          // xong — nên không cần timeout dài.
          timeout: 60000,
        }).pipe(
          catchError((error: AxiosError) => {
            this.logger.error(`AI Service error starting voice clone: ${error.message}`, error.response?.data);
            throw new HttpException(
              error.response?.data || 'Failed to start voice clone',
              error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
            );
          }),
        ),
      );
      return data;
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(error.message || 'Failed to start voice clone', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /** Poll status of a background voice-clone job started via cloneVoiceStart(). */
  async cloneVoiceStatus(jobId: string, userId?: string): Promise<any> {
    const url = `${this.baseUrl()}/api/voice/clone/status/${jobId}/`;

    try {
      const { data } = await firstValueFrom(
        this.httpService.get(url, { timeout: 15000 }).pipe(
          catchError((error: AxiosError) => {
            throw new HttpException(
              error.response?.data || 'Failed to get voice clone status',
              error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
            );
          }),
        ),
      );
      // Ghi log 1 lần khi job hoàn tất — job_id unique nên các lần poll sau bị
      // bỏ qua (P2002). Lỗi ghi log không được làm hỏng response poll.
      if (userId && data?.status === 'completed') {
        try {
          await this.prisma.aiVoiceUsage.create({
            data: {
              user_id: userId,
              kind: 'clone',
              voice_id: data.voice?.voice_id ?? null,
              job_id: jobId,
            },
          });
        } catch (logErr: any) {
          if (logErr?.code !== 'P2002') {
            this.logger.warn(`Failed to log clone usage for user ${userId}: ${logErr.message}`);
          }
        }
      }
      return data;
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(error.message || 'Failed to get voice clone status', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Xoá hẳn một giọng đã clone: AI service xoá trên MiniMax rồi xoá bản ghi Voice.
   *
   * Timeout 60s (dài hơn poll status 15s): đường truyền tới MiniMax hay chập chờn
   * nên delete_voice bên AI đã có sẵn 3 lần thử x 30s.
   */
  async deleteClonedVoice(voiceId: string): Promise<any> {
    const url = `${this.baseUrl()}/api/voice/delete/${encodeURIComponent(voiceId)}/`;
    this.logger.log(`Calling AI Service: DELETE ${url}`);

    try {
      const { data } = await firstValueFrom(
        this.httpService.delete(url, { headers: this.minimaxHeaders(), timeout: 60000 }).pipe(
          catchError((error: AxiosError) => {
            this.logger.error(`AI Service error deleting voice: ${error.message}`, error.response?.data as any);
            throw new HttpException(
              error.response?.data || 'Failed to delete voice',
              error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
            );
          }),
        ),
      );
      return data;
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(error.message || 'Failed to delete voice', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /** Generate Text-to-Speech using Minimax. */
  async generateTTS(text: string, voiceId: string, speed = 1.0, pitch = 0, volume = 100, language?: string, userId?: string): Promise<any> {
    const url = `${this.baseUrl()}/api/voice/tts/`;
    this.logger.log(`Calling AI Service: POST ${url} for voiceId=${voiceId}`);

    try {
      const { data } = await firstValueFrom(
        this.httpService.post(url, {
          text,
          voice_id: voiceId,
          speed,
          pitch,
          volume,
          language,
        }, {
          headers: this.minimaxHeaders(),
          timeout: 300000, // TTS on long text can take a while; module default (30s) is too short
        }).pipe(
          catchError((error: AxiosError) => {
            this.logger.error(`AI Service error in TTS: ${error.message}`, error.response?.data);
            throw new HttpException(
              error.response?.data || 'Failed to generate voice',
              error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
            );
          }),
        ),
      );
      // AI trả kèm audio_base64 (bytes thật của file vừa sinh) — dùng thẳng bytes
      // đó để upload Drive thay vì GET ngược lại route local-disk của AI: route đó
      // chỉ đọc được file nếu request rơi đúng instance/đĩa vừa ghi, trên Railway
      // (nhiều replica, không volume dùng chung) gần như luôn 404 ngay cả khi gọi
      // lại tức thì — xác minh thực tế 2026-07-20.
      if (data?.success && data.audio_base64) {
        const published = await this.publishTtsAudioFromBase64(String(data.audio_base64));
        data.audio_url = published.url;
        // Có audio_file_id → FE phát/tải qua GET ai/voice/tts/audio/:fileId (proxy
        // BE stream chuẩn từ Drive). Drive lỗi/chưa cấu hình → audio_url là data:
        // URL nhúng thẳng bytes — FE phát/tải trực tiếp.
        data.audio_file_id = published.fileId;
        delete data.audio_base64;
      } else if (data?.success && data.audio_url) {
        // Fallback cho AI chưa deploy bản trả audio_base64 (rollout lệch giữa 2
        // service) — giữ nguyên đường đi cũ, vẫn còn nguy cơ 404 như trên.
        const published = await this.publishTtsAudio(String(data.audio_url));
        data.audio_url = published.url;
        data.audio_file_id = published.fileId;
        if (!published.fileId) {
          const m = /(tts_[0-9a-f]{32}\.mp3)$/i.exec(published.url);
          data.audio_file_name = m ? m[1] : null;
        }
      }
      // Ghi log tiêu dùng cho trang Tổng quan AI — usage_characters là số ký tự
      // MiniMax thực tính phí. Lỗi ghi log không được làm hỏng response TTS.
      if (userId && data?.success) {
        try {
          await this.prisma.aiVoiceUsage.create({
            data: {
              user_id: userId,
              kind: 'tts',
              voice_id: voiceId,
              characters: Number(data.usage_characters) || 0,
              duration_ms: Number(data.duration) || 0,
            },
          });
        } catch (logErr: any) {
          this.logger.warn(`Failed to log TTS usage for user ${userId}: ${logErr.message}`);
        }
      }
      return data;
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(error.message || 'Failed to generate voice', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Tổng hợp tiêu dùng MiniMax voice (điểm ký tự TTS + số giọng đã clone),
   * kèm phân rã theo từng user — nguồn dữ liệu cho trang Tổng quan Tiện ích AI.
   */
  async getVoiceUsageStats(dateFrom?: string, dateTo?: string): Promise<any> {
    const where: any = {};
    if (dateFrom || dateTo) {
      where.created_at = {};
      if (dateFrom) where.created_at.gte = new Date(`${dateFrom}T00:00:00`);
      if (dateTo) where.created_at.lte = new Date(`${dateTo}T23:59:59.999`);
    }

    const rows = await this.prisma.aiVoiceUsage.findMany({
      where,
      include: { user: { select: { id: true, full_name: true, email: true } } },
      orderBy: { created_at: 'desc' },
    });

    const byUser = new Map<string, any>();
    let totalCharacters = 0;
    let totalTts = 0;
    let totalClones = 0;

    for (const row of rows) {
      let entry = byUser.get(row.user_id);
      if (!entry) {
        entry = {
          user_id: row.user_id,
          full_name: row.user?.full_name ?? row.user_id,
          email: row.user?.email ?? '',
          characters: 0,
          tts_count: 0,
          clone_count: 0,
          last_used_at: row.created_at,
        };
        byUser.set(row.user_id, entry);
      }
      if (row.kind === 'tts') {
        entry.characters += row.characters;
        entry.tts_count += 1;
        totalCharacters += row.characters;
        totalTts += 1;
      } else if (row.kind === 'clone') {
        entry.clone_count += 1;
        totalClones += 1;
      }
      if (row.created_at > entry.last_used_at) entry.last_used_at = row.created_at;
    }

    // Quy đổi điểm đã tiêu ra tiền theo đơn giá cấu hình (0 = chưa cấu hình, FE ẩn phần tiền)
    const toVnd = (chars: number) => Math.round((chars / 1000) * this.minimaxVndPer1kChars);
    const byUserList = [...byUser.values()]
      .map((u) => ({ ...u, cost_vnd: toVnd(u.characters) }))
      .sort((a, b) => b.characters - a.characters);

    return {
      success: true,
      pricing: { vnd_per_1k_chars: this.minimaxVndPer1kChars },
      total: {
        characters: totalCharacters,
        tts_count: totalTts,
        clone_count: totalClones,
        cost_vnd: toVnd(totalCharacters),
      },
      by_user: byUserList,
    };
  }

  /**
   * Đưa file audio TTS từ AI service về nơi công khai:
   * 1. Rewrite host của audio_url về voiceAiServiceUrl (AI có thể trả localhost
   *    nếu máy chạy AI chưa set AI_SERVICE_URL trong .env của nó).
   * 2. Upload lên Google Drive công ty → link vĩnh viễn, không phụ thuộc máy AI.
   * Không bao giờ throw — TTS đã thành công thì tệ nhất người dùng vẫn nhận link qua tunnel.
   *
   * Trả kèm fileId (khi upload Drive thành công) để FE phát/tải audio qua proxy
   * BE (streamTtsAudio) — link Drive uc?export=download KHÔNG stream chuẩn cho
   * trình duyệt: <audio> không đọc được duration (hiện 00:00), <a download>
   * cross-origin bị bỏ qua và điều hướng sang Drive hay lỗi.
   */
  private async publishTtsAudio(aiAudioUrl: string): Promise<{ url: string; fileId: string | null }> {
    let sourceUrl = aiAudioUrl;
    try {
      const parsed = new URL(aiAudioUrl);
      // Chỉ rewrite link media NỘI BỘ của AI (/media/...) — AI có nhánh fallback trả
      // thẳng URL CDN của MiniMax (link ngoài, vẫn phát được); rewrite link đó sẽ tạo
      // ra đường dẫn tunnel không tồn tại.
      // KHÔNG dùng thẳng /media/minimax_tts/<file> — Django chỉ serve /media qua static()
      // khi DEBUG=True, trên server thật (DEBUG=False) link này 404 nên uploadFromUrl()
      // luôn fail âm thầm. Dùng route whitelist /api/voice/tts/file/<file>.
      const mediaMatch = /^\/media\/minimax_tts\/(tts_[0-9a-f]{32}\.mp3)$/i.exec(parsed.pathname);
      if (mediaMatch) {
        sourceUrl = `${this.baseUrl().replace(/\/$/, '')}/api/voice/tts/file/${mediaMatch[1]}`;
      }
    } catch {
      return { url: aiAudioUrl, fileId: null };
    }

    try {
      let filename =
        (sourceUrl.split('/').pop() || '').split('?')[0] || `tts_${Date.now()}.mp3`;
      // Proxy stream (streamTtsAudio) chỉ phục vụ file tên tts_*.mp3 — ép prefix
      // cho cả nhánh fallback URL CDN MiniMax (tên file bất kỳ).
      if (!/^tts_/i.test(filename)) filename = `tts_${Date.now()}.mp3`;
      // Gom toàn bộ audio TTS về 1 nơi: Root/TTS Audio/{YYYY-MM-DD}/ (cùng kiểu
      // với Scraper Cào Dữ Liệu) thay vì rải vào từng folder ngày dùng chung.
      const folderId = await this.driveStorage.resolveDatedFolder('TTS Audio');
      const driveUrl = await this.driveStorage.uploadFromUrl(sourceUrl, filename, 'audio/mpeg', {
        folderId,
      });
      if (driveUrl) {
        this.logger.log(`TTS audio uploaded to Drive: ${driveUrl}`);
        // uploadFromUrl trả URL dạng uc?...&id=<fileId> — lấy lại fileId từ đó
        // để khỏi đổi chữ ký hàm dùng chung với các module scraper.
        let fileId: string | null = null;
        try {
          fileId = new URL(driveUrl).searchParams.get('id');
        } catch { /* giữ fileId null — FE fallback về link Drive */ }
        return { url: driveUrl, fileId };
      }
    } catch (err: any) {
      this.logger.warn(`TTS audio Drive upload failed, falling back to source URL: ${err.message}`);
    }
    return { url: sourceUrl, fileId: null };
  }

  /**
   * Upload thẳng bytes TTS (base64 AI trả kèm response POST /voice/tts/) lên
   * Drive — không GET ngược lại đĩa cục bộ của AI như publishTtsAudio() (fragile
   * trên Railway multi-replica, xem generateTTS()). Drive lỗi/chưa cấu hình →
   * nhúng bytes vào data: URL để FE phát/tải trực tiếp, không phụ thuộc AI hay
   * Drive nữa. Không bao giờ throw, luôn trả được ít nhất data: URL.
   */
  private async publishTtsAudioFromBase64(base64: string): Promise<{ url: string; fileId: string | null }> {
    const dataUrl = `data:audio/mpeg;base64,${base64}`;
    const buffer = Buffer.from(base64, 'base64');
    if (!buffer.length) return { url: dataUrl, fileId: null };

    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const tmpPath = path.join(os.tmpdir(), `tts_${Date.now()}_${Math.random().toString(36).slice(2)}.mp3`);
    try {
      fs.writeFileSync(tmpPath, buffer);
      const folderId = await this.driveStorage.resolveDatedFolder('TTS Audio');
      const uploaded = await this.driveStorage.uploadFromPath(tmpPath, path.basename(tmpPath), 'audio/mpeg', undefined, { folderId });
      return { url: uploaded.url, fileId: uploaded.fileId };
    } catch (err: any) {
      this.logger.warn(`TTS audio Drive upload (base64) failed, falling back to data URL: ${err.message}`);
      return { url: dataUrl, fileId: null };
    } finally {
      try { fs.unlinkSync(tmpPath); } catch { /* tmp file có thể chưa từng tạo */ }
    }
  }

  /**
   * Stream file TTS audio từ Drive về trình duyệt (phát trực tiếp hoặc tải về).
   * Route này công khai vì thẻ <audio> không gửi được JWT header — bù lại chỉ
   * phục vụ đúng file TTS (tên tts_*.mp3, mimeType audio/*), không cho lấy file
   * Drive tùy ý qua service account.
   */
  async streamTtsAudio(fileId: string, res: any, download = false, rangeHeader?: string, downloadName?: string): Promise<void> {
    let file: Awaited<ReturnType<GoogleDriveStorageService['openReadStream']>>;
    try {
      file = await this.driveStorage.openReadStream(fileId, rangeHeader);
    } catch (err: any) {
      this.logger.warn(`streamTtsAudio: cannot open Drive file ${fileId}: ${err.message}`);
      throw new HttpException('Audio file not found', HttpStatus.NOT_FOUND);
    }

    const isTtsAudio = /^tts_[\w.-]+\.mp3$/i.test(file.name) && (file.mimetype || '').startsWith('audio/');
    if (!isTtsAudio) {
      (file.stream as any).destroy?.();
      throw new HttpException('Not a TTS audio file', HttpStatus.FORBIDDEN);
    }

    res.status(file.status);
    res.setHeader('Content-Type', file.mimetype);
    res.setHeader('Accept-Ranges', 'bytes');
    if (file.contentRange) res.setHeader('Content-Range', file.contentRange);
    const length = file.contentLength ?? (file.status === 200 && file.size ? file.size : undefined);
    if (length) res.setHeader('Content-Length', String(length));
    // Tên file khi tải về: ưu tiên tên FE truyền qua ?filename= (dễ đọc hơn tên
    // tts_<hex>.mp3 trên Drive). Sanitize để chống header injection / ký tự cấm
    // trên Windows; tên có dấu tiếng Việt gửi qua filename* (RFC 5987).
    let outName = file.name;
    if (download && downloadName) {
      const cleaned = downloadName.replace(/[\r\n\/\\:*?"<>|]+/g, ' ').trim().slice(0, 150);
      if (cleaned) outName = /\.mp3$/i.test(cleaned) ? cleaned : `${cleaned}.mp3`;
    }
    const asciiName = outName.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'");
    const utf8Name = encodeURIComponent(outName).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
    res.setHeader(
      'Content-Disposition',
      `${download ? 'attachment' : 'inline'}; filename="${asciiName}"; filename*=UTF-8''${utf8Name}`,
    );
    // Drive đứt kết nối giữa chừng → kết thúc response thay vì để trình duyệt chờ treo
    (file.stream as any).on?.('error', (err: any) => {
      this.logger.warn(`streamTtsAudio: stream error for ${fileId}: ${err?.message}`);
      try { res.end(); } catch { /* response có thể đã đóng */ }
    });
    file.stream.pipe(res);
  }

  /**
   * Fallback không-Drive: stream file TTS thẳng từ AI service về trình duyệt.
   * Dùng khi Drive chưa cấu hình/upload lỗi (generateTTS trả audio_file_name).
   * AI serve file qua /api/voice/tts/file/<filename> — route whitelist, hoạt
   * động cả khi DEBUG=False (link /media/... chỉ sống khi DEBUG=True).
   */
  async streamTtsAudioFromAi(filename: string, res: any, download = false, downloadName?: string, rangeHeader?: string): Promise<void> {
    if (!/^tts_[0-9a-f]{32}\.mp3$/i.test(filename || '')) {
      throw new HttpException('Invalid TTS filename', HttpStatus.BAD_REQUEST);
    }
    let response: any;
    try {
      response = await this.httpService.axiosRef.get(
        `${this.baseUrl()}/api/voice/tts/file/${filename}`,
        {
          responseType: 'stream',
          timeout: 0,
          headers: rangeHeader ? { Range: rangeHeader } : undefined,
          validateStatus: (s) => s === 200 || s === 206,
        },
      );
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.response?.status === 404 ? 'Audio file not found' : (error.message || 'Không kết nối được tới AI service.'),
        error.response?.status || HttpStatus.BAD_GATEWAY,
      );
    }
    // Forward nguyên trạng thái 200/206 + Content-Range của AI — <audio> của trình
    // duyệt cần Accept-Ranges/206 để đọc được duration mp3 streamed, thiếu thì
    // player kẹt ở 0:00/0:00 (cùng lỗi từng vá cho nhánh Drive, xem streamTtsAudio()).
    res.status(response.status);
    res.setHeader('Content-Type', response.headers['content-type'] || 'audio/mpeg');
    res.setHeader('Accept-Ranges', 'bytes');
    const contentRange = response.headers['content-range'];
    if (contentRange) res.setHeader('Content-Range', contentRange);
    const contentLength = response.headers['content-length'];
    if (contentLength) res.setHeader('Content-Length', contentLength);
    // Tên file tải về: cùng logic sanitize với streamTtsAudio.
    let outName = filename;
    if (download && downloadName) {
      const cleaned = downloadName.replace(/[\r\n\/\\:*?"<>|]+/g, ' ').trim().slice(0, 150);
      if (cleaned) outName = /\.mp3$/i.test(cleaned) ? cleaned : `${cleaned}.mp3`;
    }
    const asciiName = outName.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'");
    const utf8Name = encodeURIComponent(outName).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
    res.setHeader(
      'Content-Disposition',
      `${download ? 'attachment' : 'inline'}; filename="${asciiName}"; filename*=UTF-8''${utf8Name}`,
    );
    response.data.on('error', (err: any) => {
      this.logger.warn(`streamTtsAudioFromAi: stream error for ${filename}: ${err?.message}`);
      try { res.end(); } catch { /* response có thể đã đóng */ }
    });
    response.data.pipe(res);
  }
}
