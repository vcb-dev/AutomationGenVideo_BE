import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

/**
 * Địa chỉ Lark đọc từ .env. Không gõ cứng: tài khoản Feishu (Trung Quốc) dùng
 * open.feishu.cn chứ không phải open.larksuite.com, và môi trường thử nghiệm cần trỏ
 * sang mock server — gõ cứng thì phải sửa mã nguồn mới đổi được.
 */
const DEFAULT_LARK_BASE_URL = 'https://open.larksuite.com/open-apis';

/**
 * Mã lỗi Lark mà thử lại KHÔNG bao giờ cứu được — đo bằng lệnh gọi thật lúc dựng tính năng:
 *
 *   99992351  open_id không tồn tại (gửi thử tới "ou_0000…")
 *   230013    người nhận nằm ngoài phạm vi sử dụng của bot
 *   99991672  app thiếu scope
 *
 * Cả ba chỉ sửa được từ phía Lark Admin hoặc bằng cách đổi mã người nhận. Gặp chúng thì chốt
 * luôn trong nhật ký thay vì thử lại đủ 3 lượt rồi mới bỏ — vừa nhanh, vừa để lộ nguyên nhân
 * thật cho người đọc log.
 */
const PERMANENT_ERROR_CODES = new Set([99992351, 230013, 99991672]);

export function isPermanentError(code: number): boolean {
  return PERMANENT_ERROR_CODES.has(code);
}

export class LarkSendError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly permanent: boolean,
  ) {
    super(message);
    this.name = 'LarkSendError';
  }
}

/**
 * Gửi message nhắn Lark. Chỉ làm đúng một việc đó.
 *
 * Vì sao là file riêng chứ không thêm vào LarkService: file kia đã 4.972 dòng và toàn bộ là
 * đọc/ghi Bitable — việc gửi message không dùng summary gì với nó ngoài mỗi khái niệm "token".
 *
 * Vì sao dùng app riêng (LARK_NOTIFY_*) chứ không phải LARK_APP_ID: app cũ đang gánh đồng bộ
 * KPI, checklist, nhân sự; nó cũng KHÔNG gửi message được vì phạm vi sử dụng hẹp (đo được lỗi
 * 230013 khi thử). Tách app để sửa quyền hay thu hồi khoá bên này không làm gãy bên kia.
 */
@Injectable()
export class LarkNotifyService {
  private readonly logger = new Logger(LarkNotifyService.name);

  /** Token dùng lại tới sát hạn; xin lại mỗi message là tốn một lượt gọi thừa cho mỗi người nhận. */
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  private get baseUrl(): string {
    return this.configService.get<string>('LARK_API_BASE_URL') || DEFAULT_LARK_BASE_URL;
  }

  async sendMessage(openId: string, content: string): Promise<{ messageId: string }> {
    const token = await this.getToken();

    let data: any;
    try {
      const res = await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/im/v1/messages?receive_id_type=open_id`,
          {
            receive_id: openId,
            msg_type: 'text',
            // Lark bắt content là CHUỖI JSON, không phải object. Truyền object thì trả lỗi
            // định dạng chứ không phải lỗi nội dung, rất khó đoán ra.
            content: JSON.stringify({ text: content }),
          },
          { headers: { Authorization: `Bearer ${token}` } },
        ),
      );
      data = res.data;
    } catch (err: any) {
      // Mạng rớt / 5xx: chưa biết Lark nghĩ gì, coi là tạm để lượt sau thử lại.
      throw new LarkSendError(`Không gọi được Lark: ${err?.message}`, -1, false);
    }

    if (data?.code !== 0) {
      const code = Number(data?.code ?? -1);
      const permanent = isPermanentError(code);
      this.logger.warn(`Gửi ${openId} hỏng: code=${code} ${data?.msg}${permanent ? ' (lỗi chết)' : ''}`);
      throw new LarkSendError(data?.msg ?? 'Lỗi không rõ', code, permanent);
    }

    return { messageId: data?.data?.message_id };
  }

  private async getToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.value;

    const appId = this.configService.get<string>('LARK_NOTIFY_APP_ID');
    const appSecret = this.configService.get<string>('LARK_NOTIFY_APP_SECRET');
    if (!appId || !appSecret) {
      throw new LarkSendError(
        'Thiếu LARK_NOTIFY_APP_ID / LARK_NOTIFY_APP_SECRET trong .env',
        -1,
        true,
      );
    }

    let data: any;
    try {
      const res = await firstValueFrom(
        this.httpService.post(`${this.baseUrl}/auth/v3/tenant_access_token/internal`, {
          app_id: appId,
          app_secret: appSecret,
        }),
      );
      data = res.data;
    } catch (err: any) {
      throw new LarkSendError(`Không lấy được token Lark: ${err?.message}`, -1, false);
    }

    if (data?.code !== 0) {
      throw new LarkSendError(
        `Không lấy được token Lark: ${data?.msg}`,
        Number(data?.code ?? -1),
        isPermanentError(Number(data?.code ?? -1)),
      );
    }

    // Trừ hao 60 giây: token hết hạn giữa lúc đang gửi dở một lô thì cả lô sau đó hỏng theo.
    const remainingMs = Math.max(0, (Number(data.expire) || 0) - 60) * 1000;
    this.token = { value: data.tenant_access_token, expiresAt: Date.now() + remainingMs };
    return this.token.value;
  }
}
