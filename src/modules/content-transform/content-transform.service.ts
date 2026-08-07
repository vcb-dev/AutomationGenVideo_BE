import { Injectable, NotFoundException, ForbiddenException, BadRequestException, ConflictException, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateTransformDto, HistoryQueryDto, UpgradeTransformDto, RescoreDto } from './dto';
import { UserRole, TransformStatus, Prisma } from '@prisma/client';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { INTERNAL_TOKEN_HEADER } from '../characters/guards/admin-or-internal.guard';
import { PaastAnalyzerService } from '../paast-analyzer/paast-analyzer.service';
import {
  PaastAnalysisPayload,
  PaastStoredScore,
  PAAST_LOGIC_VERSION,
} from '../paast-analyzer/interfaces/paast-analysis.interface';
import {
  buildPaastUpgradeSystemPrompt,
  buildPaastUpgradeUserPrompt,
} from './paast-upgrade.util';

/**
 * Kết quả chấm điểm lưu vào ContentTransformHistory.score_result và trả cho FE — chính là
 * payload PAAST nguyên bản (layers + total_score + cta_warning), không đổi tên field.
 */
type ScoreResult = PaastAnalysisPayload;

/**
 * Trạng thái chấm điểm của 1 bản ghi, dùng chung cho /transform, /rescore, /upgrade và các
 * endpoint lịch sử:
 *  - `null`    : bản ghi chưa từng có output_text (vd transform hỏng ngay từ bước viết) —
 *                không áp dụng khái niệm chấm điểm.
 *  - `pending` : ĐÃ có kịch bản kết quả nhưng CHƯA chấm điểm. Đây là trạng thái bình thường
 *                ngay sau /transform kể từ khi tách "viết kịch bản" và "chấm điểm" thành 2
 *                request riêng — KHÔNG phải lỗi, người dùng bấm "Chấm điểm content" để chấm.
 *  - `success` : đã chấm xong, có scoreResult theo khung PAAST.
 *  - `failed`  : lần chấm vừa rồi thất bại (sau khi đã tự retry), hoặc bản ghi dùng hệ điểm cũ.
 */
type ScoreStatus = 'success' | 'failed' | 'pending' | null;

/** Bản ghi cũ chấm bằng hệ 7 nhóm/23 tiêu chí + Hard Gate (đã ngừng dùng) không có `layers`. */
function isPaastScoreResult(raw: any): raw is ScoreResult {
  return !!raw && typeof raw === 'object' && !!raw.layers && !!raw.layers.prefer;
}

@Injectable()
export class ContentTransformService {
  private readonly logger = new Logger(ContentTransformService.name);

  // ── Rate limit đơn giản, in-memory, theo user — 5 lần/phút cho cả transform + upgrade
  // gộp chung 1 ngân sách. Không dùng ThrottlerModule global (đang theo dõi theo IP, phù hợp
  // chống spam theo mạng LAN NAT chứ không phải theo user) — mục này cần giới hạn ĐÚNG theo
  // user để tránh 1 người spam tốn chi phí AI, bất kể IP dùng chung với ai. Chưa cần Redis/DB
  // vì hiện chạy 1 instance duy nhất; nếu sau này scale nhiều instance sẽ cần thay bằng store
  // dùng chung (Redis) — ghi chú lại để không quên.
  private readonly rateLimitHits = new Map<string, number[]>();
  private readonly RATE_LIMIT_MAX = 5;
  private readonly RATE_LIMIT_WINDOW_MS = 60_000;

  // ── Chống bấm trùng /upgrade cho cùng 1 history_id — in-memory Set, tự dọn trong finally.
  private readonly processingUpgrades = new Set<string>();

  // ── Tương tự cho /rescore. Cần thiết hơn hẳn kể từ khi tách luồng: chấm điểm giờ là 1 nút
  // riêng người dùng chủ động bấm (thay vì chạy tự động trong /transform), nên khả năng bấm 2
  // lần liên tiếp trong lúc lượt đầu còn đang chạy là có thật.
  private readonly processingScores = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly paastAnalyzer: PaastAnalyzerService,
  ) {}

  /** Chặn spam: tối đa RATE_LIMIT_MAX lần "Chuyển đổi"/"Nâng cấp" mỗi RATE_LIMIT_WINDOW_MS/user. */
  private checkRateLimit(userId: string): void {
    const now = Date.now();
    const hits = (this.rateLimitHits.get(userId) || []).filter((t) => now - t < this.RATE_LIMIT_WINDOW_MS);

    if (hits.length >= this.RATE_LIMIT_MAX) {
      throw new HttpException(
        `Bạn đã thao tác quá nhiều lần (tối đa ${this.RATE_LIMIT_MAX} lần/phút). Vui lòng thử lại sau ít phút.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    hits.push(now);
    this.rateLimitHits.set(userId, hits);
  }

  /**
   * Chấm điểm kịch bản theo khung PAAST bằng PaastAnalyzerService, tự động thử lại tối đa 3 lần
   * (1 lần đầu + 2 retry) — model reasoning đôi khi trả JSON bị cắt cụt (chạm max_tokens) hoặc
   * timeout, phần lớn các lần thử lại sau đều thành công (đã thực đo: dao động reasoning_tokens
   * rất lớn giữa các lần gọi dù cùng input). Log rõ từng lần thử để theo dõi tỷ lệ lỗi thật của
   * tính năng theo thời gian.
   *
   * Từng thử giảm timeout retry xuống 60s để chặn tổng thời gian chờ, nhưng thực đo cho thấy
   * làm vậy TĂNG tỷ lệ thất bại (input dài/phức tạp cần >60s để suy luận xong, cắt sớm ở đúng
   * lần lẽ ra sẽ thành công) — phản tác dụng so với mục tiêu "giảm lỗi thật" của retry. Giữ
   * nguyên 120s cho MỌI lần thử; chấp nhận tổng tối đa 360s (3×120s) và đã tăng timeout phía
   * FE tương ứng để không bị client huỷ ngang khi BE vẫn đang xử lý bình thường.
   *
   * PAAST chấm trên chính kịch bản kết quả, không cần input_text hay system_prompt nhân vật —
   * đó là 2 tham số hệ chấm điểm cũ (7 nhóm/23 tiêu chí) cần, nay đã bỏ.
   */
  private async scoreContentWithRetry(outputText: string, logContext = 'chấm điểm'): Promise<ScoreResult> {
    const maxAttempts = 3;
    const timeoutsMs = [120000, 120000, 120000];
    let lastError: any;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await this.paastAnalyzer.analyzeText(outputText, timeoutsMs[attempt - 1]);
        if (attempt > 1) {
          this.logger.warn(`[${logContext}] Thành công ở lần thử ${attempt}/${maxAttempts}`);
        }
        return result;
      } catch (err: any) {
        lastError = err;

        // 4xx = lỗi TẤT ĐỊNH (request sai, content không hợp lệ...) — thử lại nguyên văn cùng
        // 1 request chắc chắn ra đúng kết quả đó, chỉ tốn thêm thời gian chờ của người dùng và
        // che mất lỗi thật. Chỉ 5xx/timeout/lỗi mạng mới đáng thử lại.
        const status = err.response?.status;
        if (typeof status === 'number' && status >= 400 && status < 500) {
          this.logger.error(
            `[${logContext}] Lỗi ${status} từ AI service — lỗi tất định, KHÔNG thử lại: ${this.extractAiErrorMessage(err)}`,
          );
          throw err;
        }

        this.logger.warn(`[${logContext}] Thất bại ở lần thử ${attempt}/${maxAttempts}: ${err.message}`);
      }
    }

    this.logger.error(`[${logContext}] Thất bại cả ${maxAttempts} lần thử — trả về scoreStatus: failed. Lỗi cuối: ${lastError?.message}`);
    throw lastError;
  }

  /**
   * Lấy message lỗi THẬT từ AI service để trả nguyên văn cho FE.
   *
   * Trước đây mọi lỗi chấm điểm đều bị thay bằng "có thể do timeout hoặc lỗi tạm thời từ AI",
   * kể cả khi nguyên nhân thật hoàn toàn khác (vd content không hợp lệ) — người dùng đọc thấy
   * "timeout" rồi bấm chấm lại vô ích vì lỗi tất định thì lần sau vẫn hệt vậy.
   */
  private extractAiErrorMessage(err: any): string {
    return err?.response?.data?.error || err?.message || 'Lỗi không xác định khi chấm điểm';
  }

  /**
   * Tìm bản ghi ĐÃ chấm thành công cho đúng kịch bản này (của chính user đó), để tái dùng điểm
   * thay vì gọi AI chấm lại.
   *
   * Giới hạn trong bản ghi của chính user — điểm chỉ phụ thuộc nội dung nên về lý thuyết dùng
   * chung được, nhưng đọc sang bản ghi user khác là mở rộng phạm vi truy cập dữ liệu không cần
   * thiết. Cùng cách phân quyền mà findLatestByContent của PaastAnalyzerService đang dùng.
   *
   * CÓ tính cả chính bản ghi đang chấm. Nếu loại trừ nó thì bấm "Chấm điểm lại" trên bản ghi đã
   * có điểm sẽ gọi AI chấm lại và ra điểm khác — đúng cái dao động cần loại bỏ.
   *
   * Chỉ tái dùng điểm có shape PAAST hợp lệ (`isPaastScoreResult`): bản ghi chấm bằng hệ điểm cũ
   * (7 nhóm/23 tiêu chí) vẫn có `score_result` khác null, nếu nhận bừa thì những bản ghi đó vĩnh
   * viễn không chấm lại được sang khung PAAST.
   *
   * VÀ phải đúng PAAST_LOGIC_VERSION hiện hành: điểm chấm bằng công thức đời trước không còn so
   * sánh được với điểm chấm hôm nay, tái dùng chúng sẽ khiến cùng một màn hình trộn lẫn điểm của
   * 2 hệ khác nhau mà người dùng không hề biết. Khác version ⇒ cache miss ⇒ chấm lại thật.
   */
  private async findCachedScoreByOutput(userId: string, outputText: string) {
    const candidates = await this.prisma.contentTransformHistory.findMany({
      where: {
        user_id: userId,
        output_text: outputText,
        score_result: { not: Prisma.DbNull },
      },
      orderBy: { created_at: 'desc' },
      take: 5,
      select: { id: true, score_result: true },
    });

    return (
      candidates.find(
        (c) =>
          isPaastScoreResult(c.score_result) &&
          (c.score_result as any).logic_version === PAAST_LOGIC_VERSION,
      ) || null
    );
  }

  /** Gắn dấu phiên bản logic vào kết quả chấm TRƯỚC khi ghi DB — nguồn cho lần tra cache sau. */
  private withLogicVersion(scoreResult: ScoreResult): PaastStoredScore {
    return { ...scoreResult, logic_version: PAAST_LOGIC_VERSION };
  }

  /** Message hiển thị cho FE: giữ nguyên lỗi thật, chỉ nói "có thể do timeout" khi ĐÚNG là timeout. */
  private buildScoreErrorMessage(err: any): string {
    const status = err?.response?.status;
    const detail = this.extractAiErrorMessage(err);

    if (typeof status === 'number' && status >= 400 && status < 500) {
      return `Không thể chấm điểm nội dung này: ${detail}`;
    }
    return `Không thể chấm điểm nội dung này (có thể do timeout hoặc lỗi tạm thời từ AI). Vui lòng thử chấm điểm lại. Chi tiết: ${detail}`;
  }

  /**
   * Get active characters list (excluding system prompt)
   */
  async getCharacters() {
    return this.prisma.character.findMany({
      where: { is_active: true },
      orderBy: { order_index: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        avatar_url: true,
        is_active: true,
        order_index: true,
        created_at: true,
        updated_at: true,
      },
    });
  }

  /**
   * Run content transform with AI or mock logic and save to history
   */
  async transformContent(userId: string, dto: CreateTransformDto) {
    this.checkRateLimit(userId);

    // Lấy nhân vật + system_prompt qua API nội bộ GET /characters/:id thay vì đọc thẳng DB.
    // fetchCharacterViaApi tự ném NotFoundException khi endpoint trả 404.
    const character = await this.fetchCharacterViaApi(dto.character_id);

    // Create pending history record
    const history = await this.prisma.contentTransformHistory.create({
      data: {
        user_id: userId,
        character_id: character.id,
        input_text: dto.input_text,
        input_type: dto.input_type || 'TEXT',
        status: TransformStatus.PENDING,
      },
    });

    const startTime = Date.now();
    try {
      // Lần gọi 1 — viết kịch bản. max_tokens 16000 vì deepseek-v4-flash là model reasoning,
      // tốn token cho bước suy luận nội bộ (reasoning_content) TRƯỚC KHI ra "content" cuối
      // cùng, và số token suy luận DAO ĐỘNG NGẪU NHIÊN rất lớn giữa các lần gọi dù cùng 1 input
      // (thực đo: 3450 → 6924 token chỉ trong 3 lần gọi liên tiếp). Tự động thử lại tối đa 3 lần
      // (writeContentWithRetry) — trước đây bước này KHÔNG có retry, 1 lần thất bại (thường do
      // timeout, xem callAiService) là cả request thất bại ngay dù thử lại thường sẽ thành công.
      const outputText = await this.writeContentWithRetry(character.system_prompt, dto.input_text, 16000, 'transform-write');
      const durationMs = Date.now() - startTime;

      // CHỦ Ý KHÔNG chấm điểm ở đây. Trước đây request này gọi AI 2 lượt nối nhau (viết kịch
      // bản rồi chấm điểm), mỗi lượt tự retry tới 3x120s => tối đa ~720s cho 1 lần bấm nút —
      // quá nặng và rất dễ bị huỷ giữa chừng, kéo theo mất luôn kết quả viết đã xong. Giờ tách
      // đôi: /transform chỉ viết (tối đa ~360s), người dùng bấm "Chấm điểm content" để gọi
      // /rescore chấm sau. Bản ghi lưu ngay với score_result = null và trả scoreStatus
      // 'pending' để FE biết là "chưa chấm", không phải "chấm thất bại".
      const updatedHistory = await this.prisma.contentTransformHistory.update({
        where: { id: history.id },
        data: {
          output_text: outputText,
          status: TransformStatus.SUCCESS,
          model_used: 'deepseek-v4-flash',
          duration_ms: durationMs,
        },
        include: {
          character: {
            select: {
              id: true,
              name: true,
              slug: true,
              avatar_url: true,
            },
          },
        },
      });

      return this.attachScoreFields(updatedHistory);
    } catch (error: any) {
      this.logger.error(`Failed to transform content: ${error.message}`);
      let errMsg = error.message || 'Lỗi không xác định trong quá trình xử lý';
      if (error.response?.data?.error) {
        errMsg = error.response.data.error;
      }
      
      const failedHistory = await this.prisma.contentTransformHistory.update({
        where: { id: history.id },
        data: {
          status: TransformStatus.FAILED,
          error_message: errMsg,
          duration_ms: Date.now() - startTime,
        },
        include: {
          character: {
            select: {
              id: true,
              name: true,
              slug: true,
              avatar_url: true,
            },
          },
        },
      });

      return this.attachScoreFields(failedHistory);
    }
  }

  /**
   * Gọi chung 1 endpoint AI service dùng cho cả viết kịch bản, chấm điểm và sửa nâng cấp.
   *
   * BUG ĐÃ SỬA: trước đây `timeoutMs` chỉ cấu hình timeout phía axios client (BE<->AI service),
   * KHÔNG hề được gửi kèm trong body — nên AI service (Django) không có cách nào biết BE muốn
   * cho phép bao lâu, và luôn tự cắt ở mốc mặc định hard-code riêng của nó (60s), bất kể BE đặt
   * timeoutMs=120000. Hệ quả: input/prompt cần >60s suy luận (rất hay xảy ra với model reasoning
   * deepseek-v4-flash, đặc biệt từ khi bỏ giới hạn 2000 ký tự input) bị cắt ngang ở 60s, trả lỗi
   * 502 chung chung, dù BE tưởng đã cho phép tới 120s. Giờ gửi kèm `timeout_seconds` để AI service
   * dùng ĐÚNG giá trị BE thực sự muốn cho lệnh gọi DeepSeek, không còn lệch âm thầm giữa 2 phía.
   */
  /**
   * Lấy nhân vật (kèm system_prompt) qua HTTP nội bộ tới chính endpoint GET /characters/:id
   * thay vì đọc thẳng DB bằng Prisma — theo yêu cầu về nguồn dữ liệu duy nhất.
   *
   * Endpoint đó chỉ mở cho ADMIN/MANAGER, trong khi /content-transform/transform mọi role đã
   * đăng nhập đều dùng được — nên KHÔNG thể forward JWT của user (MEMBER sẽ bị 403). Thay vào
   * đó gắn header x-internal-token để AdminOrInternalGuard nhận diện đây là lệnh gọi nội bộ
   * server-to-server. Nhờ vậy rào chắn với người dùng thật vẫn nguyên vẹn: MEMBER vẫn không
   * tự gọi được /characters/:id để đọc trộm system_prompt.
   *
   * Nhận cả id lẫn slug (findOneAdmin tra theo OR) — giữ đúng hành vi cũ của transformContent.
   */
  private async fetchCharacterViaApi(idOrSlug: string): Promise<{
    id: string;
    name: string;
    slug: string;
    system_prompt: string;
  }> {
    const port = this.configService.get<string>('PORT', '3000');
    const selfBaseUrl = this.configService.get<string>('SELF_API_URL', `http://127.0.0.1:${port}/api`);
    const internalToken = this.configService.get<string>('INTERNAL_API_TOKEN');

    if (!internalToken) {
      throw new HttpException(
        'Thiếu cấu hình INTERNAL_API_TOKEN — không thể lấy dữ liệu nhân vật qua API nội bộ',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    try {
      const response = await firstValueFrom(
        this.httpService.get(`${selfBaseUrl}/characters/${encodeURIComponent(idOrSlug)}`, {
          headers: { [INTERNAL_TOKEN_HEADER]: internalToken },
          timeout: 10000,
        }),
      );
      return response.data;
    } catch (error: any) {
      // 404 từ endpoint nội bộ = không có nhân vật → giữ đúng lỗi cũ mà FE đang xử lý.
      if (error.response?.status === HttpStatus.NOT_FOUND) {
        throw new NotFoundException('Không tìm thấy nhân vật phù hợp');
      }
      this.logger.error(`Không lấy được nhân vật qua API nội bộ: ${error.message}`);
      throw new HttpException(
        'Không lấy được dữ liệu nhân vật, vui lòng thử lại',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private async callAiService(
    systemPrompt: string,
    inputText: string,
    options?: { maxTokens?: number; temperature?: number; timeoutMs?: number },
  ): Promise<string> {
    const aiServiceUrl = this.configService.get<string>('AI_SERVICE_URL', 'http://localhost:8000');
    const url = `${aiServiceUrl}/api/ai/transform-content/`;
    const timeoutMs = options?.timeoutMs ?? 30000;

    const response = await firstValueFrom(
      this.httpService.post(
        url,
        {
          system_prompt: systemPrompt,
          input_text: inputText,
          ...(options?.maxTokens ? { max_tokens: options.maxTokens } : {}),
          ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
          // Giây, không phải ms — khớp với tham số `timeout` (int, giây) của _call_deepseek_raw
          // bên Django. Làm tròn lên để không vô tình cho AI service ít thời gian hơn BE thật sự chờ.
          timeout_seconds: Math.ceil(timeoutMs / 1000),
        },
        {
          timeout: timeoutMs,
        },
      ),
    );

    return response.data.output_text;
  }

  /**
   * Gọi callAiService (viết kịch bản mới HOẶC viết lại kịch bản khi nâng cấp) với tự động thử
   * lại tối đa 3 lần — cùng pattern với scoreContentWithRetry. Trước đây bước viết KHÔNG có retry
   * nào: 1 lần thất bại là cả request /transform hoặc /upgrade thất bại ngay, dù đây là đúng loại
   * lỗi timeout ngẫu nhiên (xem callAiService) mà thử lại thường sẽ thành công.
   */
  private async writeContentWithRetry(
    systemPrompt: string,
    userPrompt: string,
    maxTokens: number,
    logContext: string,
  ): Promise<string> {
    const maxAttempts = 3;
    const timeoutMs = 120000;
    let lastError: any;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await this.callAiService(systemPrompt, userPrompt, { maxTokens, timeoutMs });
        if (attempt > 1) {
          this.logger.warn(`[${logContext}] Thành công ở lần thử ${attempt}/${maxAttempts}`);
        }
        return result;
      } catch (err: any) {
        lastError = err;
        this.logger.warn(`[${logContext}] Thất bại ở lần thử ${attempt}/${maxAttempts}: ${err.message}`);
      }
    }

    this.logger.error(`[${logContext}] Thất bại cả ${maxAttempts} lần thử. Lỗi cuối: ${lastError?.message}`);
    throw lastError;
  }

  /**
   * Sửa nâng cấp kịch bản: sửa các tiêu chí PAAST đang `miss` theo thứ tự ưu tiên lớp
   * (Prefer → Acknowledge → Trust → Action → Stick, xem paast-upgrade.util.ts).
   * Nhận id lịch sử (ưu tiên, tái dùng đúng permission check của getHistoryDetail) hoặc
   * bộ 3 field thô (input_text/character_id/output_text). Sau khi có kịch bản mới, tự
   * động chấm điểm lại để so sánh điểm cũ/mới.
   */
  async upgradeContent(userId: string, roles: UserRole[], dto: UpgradeTransformDto) {
    this.checkRateLimit(userId);

    // Chống bấm trùng: nếu history_id này đang có 1 lần /upgrade chạy dở, từ chối ngay thay vì
    // xử lý song song (có thể tạo 2 bản ghi upgrade trùng lặp, tốn gấp đôi chi phí AI).
    const lockKey = dto.history_id;
    if (lockKey) {
      if (this.processingUpgrades.has(lockKey)) {
        throw new ConflictException('Bản ghi này đang được nâng cấp, vui lòng chờ hoàn tất trước khi thử lại.');
      }
      this.processingUpgrades.add(lockKey);
    }

    try {
      let inputText: string;
      let characterId: string;
      let currentOutputText: string;
      let previousScoreResult: ScoreResult | null = null;
      let ownerUserId = userId;

      if (dto.history_id) {
        const history = await this.getHistoryDetail(dto.history_id, userId, roles);
        if (!history.output_text) {
          throw new BadRequestException('Bản ghi này chưa có kịch bản kết quả để nâng cấp');
        }
        inputText = history.input_text;
        characterId = history.character_id;
        currentOutputText = history.output_text;
        previousScoreResult = history.scoreResult ?? null;
        ownerUserId = history.user_id;

        // Nâng cấp = sửa đúng các tiêu chí đang `miss`, nên bắt buộc phải có điểm trước. Từ chối
        // sớm thay vì âm thầm tự chấm baseline: FE chỉ hiện nút "Nâng cấp content theo gợi ý"
        // sau khi đã chấm xong, nên rơi vào đây nghĩa là bản ghi thật sự chưa được chấm.
        if (!previousScoreResult) {
          throw new BadRequestException(
            'Bản ghi này chưa được chấm điểm. Vui lòng bấm "Chấm điểm content" trước khi nâng cấp.',
          );
        }
      } else {
        if (!dto.input_text || !dto.character_id || !dto.output_text) {
          throw new BadRequestException(
            'Thiếu input_text/character_id/output_text — bắt buộc phải truyền history_id, hoặc đủ cả 3 field này',
          );
        }
        inputText = dto.input_text;
        characterId = dto.character_id;
        currentOutputText = dto.output_text;
      }

      // Lấy qua API nội bộ GET /characters/:id, không đọc thẳng DB — xem fetchCharacterViaApi.
      const character = await this.fetchCharacterViaApi(characterId);
      if (!character) {
        throw new NotFoundException('Không tìm thấy nhân vật phù hợp');
      }

      // Nếu chưa có điểm cũ sẵn (vd dùng path input_text trực tiếp), chấm điểm bản hiện tại
      // trước để biết ưu tiên sửa gì — không có điểm cũ thì không thể build prompt ưu tiên,
      // nên ở đây vẫn để lỗi (sau retry) làm fail cả request, khác với bước chấm lại bản MỚI
      // bên dưới (được cho phép fail độc lập, không kéo sập cả kết quả nâng cấp).
      if (!previousScoreResult) {
        previousScoreResult = await this.scoreContentWithRetry(currentOutputText, 'upgrade-baseline');
      }

      // Các tiêu chí đang `miss` lấy bằng đúng hàm của PaastAnalyzerService — hàm này đã loại
      // sẵn tiêu chí `na` (cần production, không sửa được bằng cách viết thêm chữ).
      const missing = this.paastAnalyzer.extractMissingElements(previousScoreResult);
      const upgradeSystemPrompt = buildPaastUpgradeSystemPrompt(previousScoreResult, missing);
      const upgradeUserPrompt = buildPaastUpgradeUserPrompt(inputText, character.system_prompt, currentOutputText);

      const startTime = Date.now();
      // Tự động thử lại tối đa 3 lần, cùng lý do với bước viết ở /transform (xem writeContentWithRetry).
      const newOutputText = await this.writeContentWithRetry(upgradeSystemPrompt, upgradeUserPrompt, 16000, 'upgrade-write');

      // Chấm điểm lại HOÀN TOÀN từ đầu trên bản MỚI — 1 lệnh AI mới, tự retry tối đa 3 lần,
      // không tái sử dụng bất kỳ phần nào của previousScoreResult. Lỗi ở đây KHÔNG được làm
      // hỏng kết quả nâng cấp chính — vẫn lưu output_text mới, chỉ scoreStatus: 'failed'.
      let newScoreResult: ScoreResult | null = null;
      let scoreStatus: 'success' | 'failed' = 'success';
      let scoreError: string | null = null;
      try {
        newScoreResult = await this.scoreContentWithRetry(newOutputText, 'upgrade-rescore');
      } catch (err: any) {
        scoreStatus = 'failed';
        scoreError = this.buildScoreErrorMessage(err);
      }

      const durationMs = Date.now() - startTime;

      const newHistory = await this.prisma.contentTransformHistory.create({
        data: {
          user_id: ownerUserId,
          character_id: character.id,
          input_text: inputText,
          output_text: newOutputText,
          status: TransformStatus.SUCCESS,
          model_used: 'deepseek-v4-flash (upgrade)',
          duration_ms: durationMs,
          score_result: (newScoreResult ? this.withLogicVersion(newScoreResult) : null) as any,
          overall_score: newScoreResult?.total_score ?? null,
        },
        include: {
          character: {
            select: { id: true, name: true, slug: true, avatar_url: true },
          },
        },
      });

      return {
        previous: {
          output_text: currentOutputText,
          scoreResult: previousScoreResult,
        },
        upgraded: { ...newHistory, scoreResult: newHistory.score_result, scoreStatus, scoreError },
      };
    } finally {
      if (lockKey) {
        this.processingUpgrades.delete(lockKey);
      }
    }
  }

  /**
   * Chấm điểm 1 bản ghi đã có sẵn output_text — KHÔNG gọi lại AI viết kịch bản, chỉ chạy lượt
   * gọi AI chấm điểm (có retry) rồi cập nhật score_result/overall_score vào ĐÚNG bản ghi đó,
   * không bao giờ tạo bản ghi mới.
   *
   * Đây là bước 2 của luồng đã tách đôi: dùng cho cả lần chấm ĐẦU TIÊN (nút "Chấm điểm content"
   * ngay sau khi chuyển đổi xong, và ở tab Lịch sử với bản ghi 'pending') lẫn lần chấm LẠI khi
   * lần trước thất bại.
   */
  async rescoreContent(userId: string, roles: UserRole[], dto: RescoreDto) {
    this.checkRateLimit(userId);

    const history = await this.getHistoryDetail(dto.history_id, userId, roles);
    if (!history.output_text) {
      throw new BadRequestException('Bản ghi này chưa có kịch bản kết quả để chấm điểm');
    }

    // Chống bấm trùng cho cùng 1 bản ghi — cùng lý do với /upgrade: 2 lượt chấm song song chỉ
    // tốn gấp đôi chi phí AI mà kết quả sau ghi đè kết quả trước.
    if (this.processingScores.has(history.id)) {
      throw new ConflictException('Bản ghi này đang được chấm điểm, vui lòng chờ hoàn tất trước khi thử lại.');
    }
    this.processingScores.add(history.id);

    // PAAST chấm trực tiếp trên kịch bản kết quả — không cần lấy system_prompt của nhân vật
    // như hệ chấm điểm cũ, nên bỏ luôn lượt gọi API nội bộ GET /characters/:id ở đây.
    let scoreResult: ScoreResult | null = null;
    let scoreError: string | null = null;
    // Bật khi kết quả trả về là điểm CŨ dùng lại, không phải lượt chấm mới — FE hiển thị ghi chú
    // để người dùng không tưởng nhầm vừa có một lượt chấm mới chạy.
    let fromCache = false;
    try {
      // Tái dùng điểm đã chấm cho ĐÚNG nội dung này nếu có — đây là cách duy nhất đảm bảo
      // "cùng nội dung luôn ra cùng điểm". Hạ temperature về 0 chỉ thu hẹp dao động chứ không
      // xoá được (thực đo 8 lượt cùng 1 kịch bản ở temperature=0 vẫn ra 3 kết quả khác nhau:
      // 80/90/93 — DeepSeek không đảm bảo tái lập, kể cả khi thêm seed cố định). Không gọi lại
      // AI còn tiết kiệm nguyên 1 lượt chấm cho thao tác bấm lại trên nội dung không đổi.
      const cached = await this.findCachedScoreByOutput(userId, history.output_text);
      if (cached) {
        this.logger.log(`[rescore] Tái dùng điểm đã chấm của bản ghi ${cached.id} cho nội dung y hệt`);
        scoreResult = cached.score_result as unknown as ScoreResult;
        fromCache = true;
      }

      if (!scoreResult) {
        try {
          scoreResult = await this.scoreContentWithRetry(history.output_text, 'rescore');
        } catch (err: any) {
          scoreError = this.buildScoreErrorMessage(err);
        }
      }

      // Chỉ ghi DB khi chấm THÀNH CÔNG. Trước đây luôn ghi, nên 1 lần chấm lại thất bại sẽ set
      // score_result = null và xoá mất điểm cũ vẫn còn dùng được của bản ghi.
      if (!scoreResult) {
        return { ...history, scoreResult: history.scoreResult, scoreStatus: 'failed' as const, scoreError, fromCache: false };
      }

      const updatedHistory = await this.prisma.contentTransformHistory.update({
        where: { id: history.id },
        data: {
          // Luôn ghi kèm PAAST_LOGIC_VERSION — kể cả khi điểm lấy từ cache, để chính bản ghi này
          // cũng tra cache được ở lần sau mà không phải dò ngược sang bản ghi nguồn.
          score_result: this.withLogicVersion(scoreResult) as any,
          overall_score: scoreResult.total_score ?? null,
        },
        include: {
          character: {
            select: { id: true, name: true, slug: true, avatar_url: true },
          },
        },
      });

      return { ...this.attachScoreFields(updatedHistory), fromCache };
    } finally {
      this.processingScores.delete(history.id);
    }
  }

  /**
   * Chuẩn hoá 1 bản ghi lịch sử (Prisma, field snake_case score_result) về đúng shape
   * scoreResult/scoreStatus/scoreError camelCase mà /transform, /upgrade, /rescore đã trả —
   * dùng ở GET /history, /history/member/:id, /history/:id để FE dùng chung 1 shape scoreResult
   * cho mọi nơi hiển thị.
   *
   * Bản ghi cũ chấm bằng hệ 7 nhóm/23 tiêu chí + Hard Gate (đã ngừng dùng) có shape hoàn toàn
   * khác PAAST và KHÔNG quy đổi được sang 5 lớp — bị coi như chưa có điểm, kèm thông báo mời
   * chấm lại. Cố tình không giữ code render hệ cũ ở FE chỉ để hiển thị mấy bản ghi này.
   *
   * Bản ghi có output_text nhưng score_result rỗng là trạng thái BÌNH THƯỜNG kể từ khi tách
   * /transform và /rescore (xem ScoreStatus) — trả 'pending' chứ không phải 'failed', để FE
   * hiển thị "Chưa chấm điểm" thay vì báo lỗi cho thứ chưa từng chạy. Lần chấm thất bại thật
   * sự vẫn được báo 'failed' ngay trong response của /rescore, /upgrade.
   */
  private attachScoreFields<T extends { output_text: string | null; score_result: any }>(
    history: T,
  ): Omit<T, 'score_result'> & {
    scoreResult: ScoreResult | null;
    scoreStatus: ScoreStatus;
    scoreError: string | null;
  } {
    const { score_result, ...rest } = history;
    const isLegacy = !!score_result && !isPaastScoreResult(score_result);
    const scoreResult: ScoreResult | null = isPaastScoreResult(score_result) ? score_result : null;

    let scoreStatus: ScoreStatus;
    let scoreError: string | null;

    if (!history.output_text) {
      // Chưa từng có kịch bản để chấm điểm (vd transform thất bại ngay từ bước viết) — không
      // áp dụng khái niệm thành công/thất bại chấm điểm cho trường hợp này.
      scoreStatus = null;
      scoreError = null;
    } else if (scoreResult) {
      scoreStatus = 'success';
      scoreError = null;
    } else if (isLegacy) {
      scoreStatus = 'failed';
      scoreError =
        'Bản ghi này được chấm bằng hệ điểm cũ (7 nhóm tiêu chí, đã ngừng sử dụng). Bấm "Chấm điểm content" để chấm theo khung PAAST.';
    } else {
      scoreStatus = 'pending';
      scoreError = null;
    }

    return { ...rest, scoreResult, scoreStatus, scoreError };
  }

  /**
   * Get transformation history of currently logged-in user
   */
  async getUserHistory(userId: string, query: HistoryQueryDto) {
    const page = Math.max(1, query.page || 1);
    const limit = Math.max(1, Math.min(100, query.limit || 20));
    const skip = (page - 1) * limit;

    const where: any = { user_id: userId };

    if (query.character_id) {
      where.character = {
        OR: [
          { id: query.character_id },
          { slug: query.character_id },
        ],
      };
    }

    if (query.status) {
      where.status = query.status as any;
    }

    const [total, items] = await Promise.all([
      this.prisma.contentTransformHistory.count({ where }),
      this.prisma.contentTransformHistory.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
        include: {
          character: {
            select: {
              id: true,
              name: true,
              slug: true,
              avatar_url: true,
            },
          },
        },
      }),
    ]);

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      items: items.map((item) => this.attachScoreFields(item)),
    };
  }

  /**
   * Get transformation history of a specific member (Admin or Leader only)
   */
  async getMemberHistory(
    leaderId: string,
    memberId: string,
    query: HistoryQueryDto,
    roles: UserRole[],
  ) {
    const isAdmin = roles.includes(UserRole.ADMIN) || roles.includes(UserRole.MANAGER);

    if (!isAdmin) {
      const isLeader = roles.includes(UserRole.LEADER);
      if (!isLeader) {
        throw new ForbiddenException('Chỉ có Leader, Manager hoặc Admin mới có quyền xem lịch sử thành viên');
      }

      // Check if target user is in at least one team led by this leader
      const ledTeams = await this.prisma.team.findMany({
        where: { leader_id: leaderId },
        select: { name: true },
      });

      const ledTeamNames = ledTeams.map((t) => t.name.trim().toLowerCase());
      if (ledTeamNames.length === 0) {
        throw new ForbiddenException('Bạn hiện không làm leader của team nào');
      }

      const member = await this.prisma.user.findUnique({
        where: { id: memberId },
        select: { team: true },
      });

      if (!member) {
        throw new NotFoundException('Không tìm thấy thành viên này');
      }

      const memberTeams = member.team
        ? member.team.split(',').map((t) => t.trim().toLowerCase())
        : [];

      const isMemberInTeam = memberTeams.some((tName) => ledTeamNames.includes(tName));

      if (!isMemberInTeam) {
        throw new ForbiddenException('Thành viên này không thuộc bất kỳ team nào do bạn quản lý');
      }
    }

    // Reuse query building logic
    const page = Math.max(1, query.page || 1);
    const limit = Math.max(1, Math.min(100, query.limit || 20));
    const skip = (page - 1) * limit;

    const where: any = { user_id: memberId };

    if (query.character_id) {
      where.character = {
        OR: [
          { id: query.character_id },
          { slug: query.character_id },
        ],
      };
    }

    if (query.status) {
      where.status = query.status as any;
    }

    const [total, items] = await Promise.all([
      this.prisma.contentTransformHistory.count({ where }),
      this.prisma.contentTransformHistory.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
        include: {
          character: {
            select: {
              id: true,
              name: true,
              slug: true,
              avatar_url: true,
            },
          },
        },
      }),
    ]);

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      items: items.map((item) => this.attachScoreFields(item)),
    };
  }

  /**
   * Get full details of a single transformation history entry
   */
  async getHistoryDetail(id: string, userId: string, roles: UserRole[]) {
    const history = await this.prisma.contentTransformHistory.findUnique({
      where: { id },
      include: {
        character: {
          select: {
            id: true,
            name: true,
            slug: true,
            avatar_url: true,
          },
        },
      },
    });

    if (!history) {
      throw new NotFoundException('Không tìm thấy bản ghi lịch sử');
    }

    const isAdmin = roles.includes(UserRole.ADMIN) || roles.includes(UserRole.MANAGER);
    if (!isAdmin && history.user_id !== userId) {
      const isLeader = roles.includes(UserRole.LEADER);
      if (!isLeader) {
        throw new ForbiddenException('Bạn không có quyền xem chi tiết bản ghi này');
      }

      // Check if target user belongs to leader's team
      const ledTeams = await this.prisma.team.findMany({
        where: { leader_id: userId },
        select: { name: true },
      });

      const ledTeamNames = ledTeams.map((t) => t.name.trim().toLowerCase());
      if (ledTeamNames.length === 0) {
        throw new ForbiddenException('Bạn hiện không làm leader của team nào');
      }

      const targetUser = await this.prisma.user.findUnique({
        where: { id: history.user_id },
        select: { team: true },
      });

      if (!targetUser) {
        throw new NotFoundException('Không tìm thấy người sở hữu bản ghi');
      }

      const targetTeams = targetUser.team
        ? targetUser.team.split(',').map((t) => t.trim().toLowerCase())
        : [];

      const isMemberInTeam = targetTeams.some((tName) => ledTeamNames.includes(tName));

      if (!isMemberInTeam) {
        throw new ForbiddenException('Bạn không có quyền xem chi tiết bản ghi này (thành viên không thuộc team của bạn)');
      }
    }

    return this.attachScoreFields(history);
  }

  async transcribeUpload(file: Express.Multer.File, authorization?: string): Promise<any> {
    const FormData = require('form-data');
    const aiServiceUrl = this.configService.get<string>('AI_SERVICE_URL', 'http://localhost:8000');
    const url = `${aiServiceUrl}/api/content/transcribe-upload/`;

    const formData = new FormData();
    formData.append('file', file.buffer, {
      filename: file.originalname,
      contentType: file.mimetype,
    });

    try {
      const response = await firstValueFrom(
        this.httpService.post(url, formData, {
          // AI endpoint yêu cầu IsAuthenticated — forward nguyên Bearer JWT của FE,
          // AI validate bằng chung JWT_SECRET (core.authentication.NestJWTAuthentication).
          headers: { ...formData.getHeaders(), ...(authorization ? { Authorization: authorization } : {}) },
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          timeout: 60000, // 60s timeout
        }),
      );
      return response.data;
    } catch (error: any) {
      this.logger.error(`Failed to transcribe file: ${error.message}`);
      const errMsg = error.response?.data?.error_message || error.response?.data?.error || error.message || 'Lỗi kết nối tới AI Service';
      throw new HttpException(errMsg, error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
