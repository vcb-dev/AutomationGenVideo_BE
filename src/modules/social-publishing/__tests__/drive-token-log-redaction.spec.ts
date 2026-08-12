import { Logger } from '@nestjs/common';
import axios from 'axios';
import { GoogleDriveStorageService } from '../upload/google-drive-storage.service';

jest.mock('axios');

/**
 * Cron làm mới token Drive chạy mỗi phút. Trước đây mỗi lần chạy đều ghi mười ký tự đầu của
 * refresh_token vào log, nên mảnh đó bị nhân bản hàng nghìn lần vào log gom trên Railway —
 * ai đọc được log là ghép lại được token.
 *
 * Test này khoá lại điều đó: bất kể nhánh thành công hay thất bại, không dòng log nào được
 * chứa refresh_token. client_id thì ngược lại — phải có, vì đó chính là thứ cần thấy khi
 * chẩn đoán lỗi sai cặp OAuth client.
 */
const REFRESH_TOKEN = 'RT-sieu-bi-mat-khong-duoc-lo-1234567890';
const CLIENT_ID = 'client-abc.apps.googleusercontent.com';

function captureLogs() {
  const lines: string[] = [];
  const push = (...args: any[]) => {
    lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  };
  jest.spyOn(Logger.prototype, 'debug').mockImplementation(push);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(push);
  jest.spyOn(Logger.prototype, 'log').mockImplementation(push);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(push);
  return lines;
}

describe('GoogleDriveStorageService — không rò refresh_token ra log', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env = {
      ...OLD_ENV,
      GOOGLE_DRIVE_REFRESH_TOKEN: REFRESH_TOKEN,
      GOOGLE_DRIVE_CLIENT_ID: CLIENT_ID,
      GOOGLE_DRIVE_CLIENT_SECRET: 'secret-abc',
    };
  });

  afterEach(() => {
    process.env = OLD_ENV;
    jest.restoreAllMocks();
  });

  it('lấy token thành công thì log không chứa refresh_token', async () => {
    const lines = captureLogs();
    (axios.post as jest.Mock).mockResolvedValue({
      data: { access_token: 'AT-xyz', expires_in: 3600 },
    });

    const service = new GoogleDriveStorageService();
    await (service as any).getAccessToken();

    const all = lines.join('\n');
    expect(all).not.toContain(REFRESH_TOKEN);
    expect(all).not.toContain(REFRESH_TOKEN.slice(0, 10));
  });

  it('log vẫn nêu client_id để chẩn đoán được lỗi sai cặp OAuth', async () => {
    const lines = captureLogs();
    (axios.post as jest.Mock).mockResolvedValue({
      data: { access_token: 'AT-xyz', expires_in: 3600 },
    });

    const service = new GoogleDriveStorageService();
    await (service as any).getAccessToken();

    expect(lines.join('\n')).toContain(CLIENT_ID);
  });

  it('lỗi unauthorized_client thì nói rõ token không thuộc client, không lộ token', async () => {
    const lines = captureLogs();
    (axios.post as jest.Mock).mockRejectedValue({
      response: { data: { error: 'unauthorized_client' } },
    });

    const service = new GoogleDriveStorageService();
    await expect((service as any).getAccessToken()).rejects.toBeDefined();

    const all = lines.join('\n');
    expect(all).toContain('KHÔNG thuộc client_id');
    expect(all).not.toContain(REFRESH_TOKEN);
  });
});
