import { Controller, Get, Param, Query, Req, Res, UseGuards, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { MediaTokenGuard } from '../../common/guards/media-token.guard';
import { CacheService } from '../../common/cache/cache.service';
import { AiIntegrationService } from '../ai-integration/ai-integration.service';
import { PlayUrlNoCreditError } from '../ai-integration/play-url-errors';

/**
 * Phát video Douyin / Kuaishou / Xiaohongshu ngay trên web hệ thống.
 *
 * Vì sao phải có trung gian này thay vì để thẻ <video> trỏ thẳng vào CDN — đã thử thật:
 *   - Douyin CHẶN THEO REFERER: gọi kèm referer vcbi.vn → 403; gọi từ server → 206.
 *   - Xiaohongshu trả link `http://`, trang chạy HTTPS nhúng vào là bị chặn mixed content.
 *   - Link CÓ HẠN (Douyin nhúng mốc hết hạn trong đường dẫn, đo được còn ~3 giờ).
 *
 * Năm nền tảng còn lại (YouTube, TikTok, Bilibili, Facebook, Instagram) KHÔNG đi qua đây —
 * FE nhúng iframe chính chủ, không tốn băng thông của mình.
 *
 * Bắt buộc phải chuyển tiếp header Range: thẻ <video> dựa vào đó để tua. Thiếu nó thì video
 * chạy được nhưng kéo thanh thời gian sẽ đứng.
 */
// MediaTokenGuard chu KHONG phai JwtAuthGuard: the <video src> khong gan duoc header
// Authorization, nen token phai nhan qua query ?t=. Xem chu thich trong media-token.guard.ts.
@UseGuards(MediaTokenGuard)
@Controller('scraper/stream')
export class VideoStreamController {
  private readonly logger = new Logger(VideoStreamController.name);

  /** Link phát hết hạn ~3 giờ; cache 2 giờ để luôn còn hạn khi đem ra dùng. */
  private static readonly PLAY_URL_TTL_MS = 2 * 60 * 60 * 1000;

  /** Lần gần nhất TikHub báo hết số dư. Chỉ để trả lời câu hỏi "vì sao video hỏng". */
  private static lanCuoiHetSoDu = 0;
  private static readonly NHO_HET_SO_DU_MS = 10 * 60 * 1000;

  constructor(
    private readonly cache: CacheService,
    private readonly aiIntegration: AiIntegrationService,
  ) {}

  /**
   * Vì sao video không phát được — KHÔNG tốn lượt TikHub nào.
   *
   * Chỉ đọc lại dấu vết của lần hỏng gần nhất chứ không đi hỏi TikHub. Nếu để giao diện tự
   * gọi lại đường phát để dò nguyên nhân thì mỗi video hỏng lại kéo theo một lượt gọi TÍNH
   * PHÍ — cuộn qua mười video hỏng là mười lượt.
   *
   * Phải khai TRƯỚC ':platform/:videoId'. Thực ra đường này chỉ có một đoạn nên không đụng
   * route hai đoạn kia, nhưng đặt trước cho khỏi phụ thuộc vào chi tiết đó.
   */
  @Get('trang-thai')
  trangThai(@Res() res: Response): void {
    const conMoi = Date.now() - VideoStreamController.lanCuoiHetSoDu < VideoStreamController.NHO_HET_SO_DU_MS;
    if (VideoStreamController.lanCuoiHetSoDu > 0 && conMoi) {
      res.status(402).json({
        message: 'Hết số dư TikHub — tạm thời không xem được video Douyin / TikTok / XiaoHongShu / Kuaishou. Cần nạp thêm.',
        reason: 'no_credit',
      });
      return;
    }
    res.json({ ok: true });
  }

  @Get(':platform/:videoId')
  async stream(
    @Param('platform') platform: string,
    @Param('videoId') videoId: string,
    @Query('url') videoUrl: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const key = `play-url:${platform}:${videoId}:${videoUrl || ''}`;

    // Chuyển tiếp Range để thẻ <video> tua được.
    const range = req.headers.range;
    const headers: Record<string, string> = {
      // KHÔNG gửi Referer: chính referer làm Douyin trả 403.
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36',
    };
    if (range) headers.Range = range;

    // Link phát trong bộ đệm có thể đã hết hạn trước khi hết TTL — nền tảng trả 403/410.
    // Gặp vậy thì XOÁ bộ đệm và xin link mới, thử lại đúng MỘT lần. Không có vòng thử lại
    // này thì một link hỏng làm video chết suốt 2 tiếng (đã đo thật: 502 trả về sau 16ms,
    // tức là còn chưa gọi tới nền tảng — trúng bộ đệm hỏng).
    let upstream: globalThis.Response | null = null;
    for (let luot = 0; luot < 2; luot++) {
      if (luot > 0) await this.cache.invalidate(key);

      let playUrl: string | null;
      try {
        // Từ lượt thứ hai: ép AI gọi mới, đừng nhận lại link vừa hỏng từ bộ đệm của nó.
        playUrl = await this.layLinkPhat(key, platform, videoId, videoUrl, luot > 0);
      } catch (err) {
        if (err instanceof PlayUrlNoCreditError) {
          VideoStreamController.lanCuoiHetSoDu = Date.now();
          // 402 để phía gọi phân biệt được với "video này hỏng".
          res.status(402).json({
            message: 'Hết số dư TikHub — tạm thời không xem được video Douyin / TikTok / XiaoHongShu / Kuaishou. Cần nạp thêm.',
            reason: 'no_credit',
          });
          return;
        }
        throw err;
      }
      if (!playUrl) {
        res.status(404).json({ message: 'Không lấy được link phát cho video này.' });
        return;
      }
      // Xin được link tức là tài khoản có tiền trở lại → xoá mốc cũ ngay, đừng bắt người
      // dùng nhìn thông báo "hết số dư" thêm mười phút sau khi đã nạp.
      VideoStreamController.lanCuoiHetSoDu = 0;

      const res1 = await this.taiTuNguon(playUrl, headers, platform, videoId);
      if (!res1) {
        res.status(502).json({ message: 'Không tải được video từ nguồn.' });
        return;
      }

      if (res1.ok || res1.status === 206) { upstream = res1; break; }

      // 403/410 = link hết hạn → đáng để xin lại. Mã khác thì xin lại cũng vô ích.
      const dangHetHan = res1.status === 403 || res1.status === 410;
      this.logger.warn(`[stream] ${platform}/${videoId} nguon tra HTTP ${res1.status}${dangHetHan && luot === 0 ? ' — xin link moi roi thu lai' : ''}`);
      res1.body?.cancel().catch(() => {});
      if (!dangHetHan || luot > 0) {
        res.status(502).json({ message: `Nguồn trả về lỗi ${res1.status}.` });
        return;
      }
    }
    if (!upstream) {
      res.status(502).json({ message: 'Không tải được video từ nguồn.' });
      return;
    }

    for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const value = upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    }
    if (!upstream.headers.get('accept-ranges')) res.setHeader('accept-ranges', 'bytes');
    // Cho trình duyệt cache ngắn — cuộn qua cuộn lại không phải tải lại từ đầu.
    res.setHeader('cache-control', 'private, max-age=600');
    res.status(upstream.status === 206 ? 206 : 200);

    if (!upstream.body) {
      res.end();
      return;
    }

    // Đổ dữ liệu theo dòng, không nạp cả video vào RAM.
    const reader = upstream.body.getReader();
    let daDong = false;
    const danhDauDong = () => { daDong = true; };
    res.on('close', danhDauDong);
    res.on('error', danhDauDong);
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done || daDong) break;
        if (!res.write(Buffer.from(value))) {
          // Chờ trình duyệt tiêu thụ bớt. PHẢI chờ cả 'close'/'error': người dùng cuộn sang
          // video khác giữa lúc đang nghẽn thì 'drain' KHÔNG BAO GIỜ tới, lời hứa treo vĩnh
          // viễn và giữ luôn kết nối tới nền tảng gốc.
          await new Promise<void>((resolve) => {
            const xong = () => {
              res.off('drain', xong); res.off('close', xong); res.off('error', xong);
              resolve();
            };
            res.once('drain', xong);
            res.once('close', xong);
            res.once('error', xong);
          });
          if (daDong) break;
        }
      }
      if (!daDong) res.end();
    } catch {
      // Người dùng cuộn sang video khác giữa chừng → kết nối đứt, không phải lỗi.
      res.destroy();
    } finally {
      res.off('close', danhDauDong);
      res.off('error', danhDauDong);
      reader.cancel().catch(() => {});
    }
  }

  /**
   * Lấy link phát, có bộ đệm — nhưng KHÔNG đệm lần thất bại.
   *
   * CacheService đệm đúng thứ hàm trả về, kể cả `null`. Để nguyên thì một lần nền tảng trục
   * trặc là video đó chết suốt 2 tiếng dù lát sau nền tảng đã bình thường trở lại.
   */
  private async layLinkPhat(
    key: string,
    platform: string,
    videoId: string,
    videoUrl?: string,
    lamMoi = false,
  ): Promise<string | null> {
    let playUrl: string | null = null;
    try {
      playUrl = await this.cache.get<string | null>(key, VideoStreamController.PLAY_URL_TTL_MS, () =>
        this.aiIntegration.fetchVideoPlayUrl({ platform, videoId, videoUrl, forceRefresh: lamMoi }),
      );
    } catch (err) {
      // Hết số dư: PHẢI xoá bộ đệm rồi ném tiếp. Nuốt thành null thì người dùng nhận
      // "không lấy được link phát" và không ai biết lý do thật là tài khoản hết tiền.
      await this.cache.invalidate(key);
      if (err instanceof PlayUrlNoCreditError) throw err;
      playUrl = null;
    }
    if (!playUrl) await this.cache.invalidate(key);
    return playUrl;
  }

  /**
   * Mở kết nối tới nền tảng gốc.
   *
   * Hạn giờ chỉ tính cho lúc CHỜ HỒI ĐÁP, không tính lúc đang chảy dữ liệu. Dùng
   * `AbortSignal.timeout(30000)` như trước là bấm giờ cho CẢ quá trình: đã đo thật — ép mạng
   * xuống 150KB/s thì video 8,4 MB bị cắt ở giây thứ 33 khi mới tải được 5,0 MB, người xem
   * thấy video đang chạy thì khựng hẳn. Mạng chậm hoặc video dài là dính.
   */
  private async taiTuNguon(
    playUrl: string,
    headers: Record<string, string>,
    platform: string,
    videoId: string,
  ): Promise<globalThis.Response | null> {
    const boQua = new AbortController();
    const hanGio = setTimeout(() => boQua.abort(), 30000);
    try {
      return await fetch(playUrl, { headers, signal: boQua.signal });
    } catch (err: any) {
      this.logger.warn(`[stream] ${platform}/${videoId} khong tai duoc: ${err?.message}`);
      return null;
    } finally {
      // Có hồi đáp rồi thì gỡ hạn giờ — phần thân được chảy bao lâu tuỳ mạng.
      clearTimeout(hanGio);
    }
  }
}
