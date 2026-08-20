import { of, throwError } from 'rxjs';
import { HttpException, HttpStatus } from '@nestjs/common';
import { VideoScriptTranslateService } from '../video-script-translate.service';

/**
 * VideoScriptTranslateService — bản tách khỏi AiIntegrationService.translateVideoScript(), cùng
 * pattern với PaastService (../../paast/paast.service.ts). CHƯA được đăng ký làm provider/dùng ở
 * đâu (video-script.service.ts, catalog.service.ts, ai-integration.controller.ts vẫn gọi qua
 * AiIntegrationService), nhưng vẫn nằm trong src/*.ts nên vẫn cần test riêng theo luật CI.
 */
describe('VideoScriptTranslateService.translateVideoScript', () => {
  function build() {
    const httpService: any = { post: jest.fn(() => of({ data: {} })) };
    const configService: any = {
      get: jest.fn((key: string, def?: string) =>
        key === 'AI_SERVICE_URL' ? 'http://localhost:8001' : def,
      ),
    };
    const service = new VideoScriptTranslateService(httpService, configService);
    return { service, httpService };
  }

  it('gọi đúng endpoint AI service với content/hashtags/language, trả về data khi thành công', async () => {
    const { service, httpService } = build();
    httpService.post.mockReturnValueOnce(
      of({ data: { content: 'translated content', hashtags: ['#a', '#b'] } }),
    );

    const result = await service.translateVideoScript({
      content: 'nội dung gốc',
      hashtags: ['#gốc'],
      language: 'en',
    });

    expect(httpService.post).toHaveBeenCalledWith(
      'http://localhost:8001/api/task-auto/video-script/translate/',
      { content: 'nội dung gốc', hashtags: ['#gốc'], language: 'en' },
      expect.objectContaining({ timeout: 120000 }),
    );
    expect(result).toEqual({ content: 'translated content', hashtags: ['#a', '#b'] });
  });

  it('AI service trả lỗi có response → ném HttpException đúng status của response', async () => {
    const { service, httpService } = build();
    httpService.post.mockReturnValueOnce(
      throwError(() => ({
        message: 'Bad request',
        response: { status: 422, data: { error: 'market không hợp lệ' } },
      })),
    );

    await expect(
      service.translateVideoScript({ content: 'x', hashtags: [], market: 'zz' }),
    ).rejects.toMatchObject({
      status: 422,
      response: { error: 'market không hợp lệ' },
    });
  });

  it('AI service lỗi không có response (network/timeout) → HttpException 500', async () => {
    const { service, httpService } = build();
    httpService.post.mockReturnValueOnce(throwError(() => ({ message: 'timeout of 120000ms exceeded' })));

    await expect(
      service.translateVideoScript({ content: 'x', hashtags: [] }),
    ).rejects.toMatchObject({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
    });
  });

  it('kết quả là HttpException', async () => {
    const { service, httpService } = build();
    httpService.post.mockReturnValueOnce(throwError(() => ({ message: 'boom' })));

    await expect(
      service.translateVideoScript({ content: 'x', hashtags: [] }),
    ).rejects.toBeInstanceOf(HttpException);
  });
});
