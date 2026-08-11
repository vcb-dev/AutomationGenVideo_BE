import { of, throwError } from 'rxjs';

import { LarkNotifyService, LarkSendError, isPermanentError } from '../lark-notify.service';

/**
 * Các mã lỗi dưới đây lấy từ lệnh gọi THẬT lên Lark trong lúc dựng tính năng (06–07/08/2026),
 * không phải chép từ tài liệu:
 *
 *   99992351  gửi tới open_id bịa "ou_0000…"        → "not a valid {open_id} or not exists"
 *   230013    gửi bằng app LARK_APP_ID cũ           → "Bot has NO availability to this user"
 *   99991672  tra danh bạ khi chưa cấp scope        → "Access denied. One of the following scopes…"
 *
 * Cả ba đều VÔ ÍCH nếu thử lại: mã người nhận sai thì gửi lại vẫn sai, phạm vi bot và scope chỉ
 * đổi được từ Lark Admin. Thử lại chỉ đốt lượt gọi và làm cron chạy lâu vô ích.
 */

const CAU_HINH: Record<string, string> = {
  LARK_NOTIFY_APP_ID: 'cli_test',
  LARK_NOTIFY_APP_SECRET: 'secret_test',
};

function dungService(post: jest.Mock) {
  const httpService = { post } as any;
  const configService = { get: (k: string) => CAU_HINH[k] } as any;
  return new LarkNotifyService(httpService, configService);
}

const dapTokenOk = () => of({ data: { code: 0, tenant_access_token: 'tk_1', expire: 7200 } });
const dapGuiOk = () => of({ data: { code: 0, data: { message_id: 'om_abc' } } });
const dapLoi = (code: number, msg = 'loi') => of({ data: { code, msg } });

describe('isPermanentError — phân biệt lỗi chết với lỗi tạm', () => {
  it('mã người nhận sai là lỗi chết, thử lại vô nghĩa', () => {
    expect(isPermanentError(99992351)).toBe(true);
  });

  it('ngoài phạm vi sử dụng của bot là lỗi chết — chỉ Lark Admin sửa được', () => {
    expect(isPermanentError(230013)).toBe(true);
  });

  it('thiếu scope là lỗi chết — chờ cấp quyền, không phải chờ mạng', () => {
    expect(isPermanentError(99991672)).toBe(true);
  });

  it('mã lạ coi là lỗi tạm để còn được thử lại', () => {
    expect(isPermanentError(50000)).toBe(false);
    expect(isPermanentError(0)).toBe(false);
  });
});

describe('LarkNotifyService.sendMessage', () => {
  it('gửi được thì trả message_id', async () => {
    const post = jest.fn()
      .mockImplementationOnce(dapTokenOk)
      .mockImplementationOnce(dapGuiOk);

    const result = await dungService(post).sendMessage('ou_that', 'xin chào');

    expect(result.messageId).toBe('om_abc');
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('gửi đúng open_id và nội dung Lark yêu cầu (content là chuỗi JSON, không phải object)', async () => {
    const post = jest.fn()
      .mockImplementationOnce(dapTokenOk)
      .mockImplementationOnce(dapGuiOk);

    await dungService(post).sendMessage('ou_that', 'nội dung');

    const [url, body] = post.mock.calls[1];
    expect(url).toContain('receive_id_type=open_id');
    expect(body.receive_id).toBe('ou_that');
    expect(body.msg_type).toBe('text');
    expect(typeof body.content).toBe('string');
    expect(JSON.parse(body.content)).toEqual({ text: 'nội dung' });
  });

  it('lỗi chết thì ném LarkSendError có permanent = true', async () => {
    const post = jest.fn()
      .mockImplementationOnce(dapTokenOk)
      .mockImplementationOnce(() => dapLoi(230013, 'Bot has NO availability to this user'));

    const service = dungService(post);
    await expect(service.sendMessage('ou_ngoai_pham_vi', 'x')).rejects.toMatchObject({
      code: 230013,
      permanent: true,
    });
  });

  it('lỗi tạm thì permanent = false để lượt sau còn thử lại', async () => {
    const post = jest.fn()
      .mockImplementationOnce(dapTokenOk)
      .mockImplementationOnce(() => dapLoi(50000, 'internal error'));

    await expect(dungService(post).sendMessage('ou_that', 'x')).rejects.toMatchObject({
      permanent: false,
    });
  });

  it('mạng rớt cũng là lỗi tạm', async () => {
    const post = jest.fn()
      .mockImplementationOnce(dapTokenOk)
      .mockImplementationOnce(() => throwError(() => new Error('ECONNRESET')));

    await expect(dungService(post).sendMessage('ou_that', 'x')).rejects.toMatchObject({
      permanent: false,
    });
  });

  it('lấy token hỏng thì báo lỗi tạm, KHÔNG chốt oan video', async () => {
    const post = jest.fn().mockImplementationOnce(() => dapLoi(99991663, 'app not found'));

    await expect(dungService(post).sendMessage('ou_that', 'x')).rejects.toBeInstanceOf(LarkSendError);
  });

  it('token dùng lại cho lần gửi sau, không xin lại mỗi message', async () => {
    const post = jest.fn()
      .mockImplementationOnce(dapTokenOk)
      .mockImplementation(dapGuiOk);

    const service = dungService(post);
    await service.sendMessage('ou_a', 'message 1');
    await service.sendMessage('ou_b', 'message 2');

    // 1 lần xin token + 2 lần gửi = 3, chứ không phải 4
    expect(post).toHaveBeenCalledTimes(3);
  });

  it('thiếu cấu hình app thì báo ngay, không gọi mạng', async () => {
    const post = jest.fn();
    const httpService = { post } as any;
    const configService = { get: () => undefined } as any;
    const service = new LarkNotifyService(httpService, configService);

    await expect(service.sendMessage('ou_that', 'x')).rejects.toThrow(/LARK_NOTIFY_APP_ID/);
    expect(post).not.toHaveBeenCalled();
  });
});
