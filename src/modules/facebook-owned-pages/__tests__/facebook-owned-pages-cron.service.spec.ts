import { Logger } from '@nestjs/common';
import { FacebookOwnedPagesCronService } from '../facebook-owned-pages-cron.service';

// Token Facebook chết âm thầm: lần trước phải curl tay mới phát hiện, sau khi cả 95
// page đã hỏng import nhiều ngày. Cron này chỉ có giá trị nếu kết quả HIỆN RA ở
// console — nên đúng thứ cần khoá lại bằng test là dòng log, không phải giá trị trả về.
describe('FacebookOwnedPagesCronService — gia hạn token', () => {
  let service: FacebookOwnedPagesCronService;
  let aiClient: { refreshUserToken: jest.Mock };
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    aiClient = { refreshUserToken: jest.fn() };
    service = new FacebookOwnedPagesCronService({} as any, {} as any, aiClient as any);
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('token gia hạn được thì log số ngày còn lại', async () => {
    aiClient.refreshUserToken.mockResolvedValue({ status: 'refreshed', message: 'Đã gia hạn token, còn 60 ngày' });

    await service.cronRefreshUserToken();

    expect(logSpy.mock.calls.flat().join(' ')).toContain('Đã gia hạn token, còn 60 ngày');
  });

  it('token chết thì log lỗi kèm hướng dẫn đăng nhập lại', async () => {
    aiClient.refreshUserToken.mockResolvedValue({
      status: 'invalid',
      message: 'Token không gia hạn được — cần đăng nhập lại: the user logged out',
    });

    await service.cronRefreshUserToken();

    expect(errorSpy.mock.calls.flat().join(' ')).toContain('cần đăng nhập lại');
  });

  it('AI không phản hồi thì log lỗi chứ không làm sập cron', async () => {
    aiClient.refreshUserToken.mockRejectedValue(new Error('connect ECONNREFUSED'));

    await expect(service.cronRefreshUserToken()).resolves.toBeUndefined();
    expect(errorSpy.mock.calls.flat().join(' ')).toContain('ECONNREFUSED');
  });
});
