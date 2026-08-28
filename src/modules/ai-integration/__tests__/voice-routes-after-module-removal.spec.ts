import { readFileSync } from 'fs';
import { join } from 'path';
import { PATH_METADATA } from '@nestjs/common/constants';
import { AiIntegrationController } from '../ai-integration.controller';

/**
 * PR gỡ src/modules/voice khỏi main. Module đó không bao giờ chạy vì khai trùng route với
 * AiIntegrationController, mà AiIntegrationModule đăng ký trước nên NestJS luôn dùng route cũ.
 *
 * Test này khoá lại điều quan trọng nhất của việc gỡ: 10 route voice PHẢI còn nguyên trên
 * ai-integration. Nếu ai đó gỡ nhầm cả route cũ, client đang gọi /api/ai/voice/* sẽ nhận 404
 * mà build vẫn xanh — hỏng âm thầm đúng kiểu khó lần ra nhất.
 */

/** Đọc path mà decorator @Get/@Post/@Delete gắn lên từng method của controller. */
function routePathsOf(controller: any): string[] {
  const proto = controller.prototype;
  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== 'constructor' && typeof proto[name] === 'function')
    .map((name) => Reflect.getMetadata(PATH_METADATA, proto[name]))
    .filter((path): path is string => typeof path === 'string');
}

describe('gỡ VoiceModule không được làm mất route voice', () => {
  const paths = routePathsOf(AiIntegrationController);

  it.each([
    'voice/quota',
    'voice/quota/grant',
    'voice/list',
    'voice/clone',
    'voice/clone/start',
    'voice/clone/status/:jobId',
    'voice/:voiceId',
    'voice/usage/stats',
    'voice/tts/audio/:fileId',
    'voice/tts/stream/:filename',
    'voice/tts',
    'voice/translate-text',
  ])('ai-integration vẫn phục vụ %s', (route) => {
    expect(paths).toContain(route);
  });

  it('controller khai đủ 12 route voice, không hụt cái nào', () => {
    expect(paths.filter((p) => p.startsWith('voice'))).toHaveLength(12);
  });

  it('app.module không còn nhắc tới VoiceModule', () => {
    // Đọc file dạng văn bản thay vì import AppModule: import sẽ kéo theo cả cây module và
    // nổ ở alias '@/' mà jest chưa resolve — không đáng dựng cả hạ tầng đó chỉ để kiểm một dòng.
    const src = readFileSync(join(__dirname, '../../../app.module.ts'), 'utf8');
    expect(src).not.toContain('VoiceModule');
    expect(src).not.toContain('modules/voice/voice.module');
  });
});
