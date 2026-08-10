import { of } from 'rxjs';
import { Logger } from '@nestjs/common';
import { VoiceService } from '../voice.service';

/**
 * Chức năng: cấu hình URL của module voice là BẮT BUỘC — không còn URL fallback nào
 * trong code, kể cả localhost.
 *
 * Đây là điểm khác cố ý so với phần còn lại của repo (các service khác fallback
 * localhost:8001): module voice được xây lại với yêu cầu "không một URL nào nằm
 * trong code". Đổi lại, thiếu env thì phải HỎNG TO — 503 kèm đúng tên biến cần khai
 * — chứ không âm thầm gọi vào một địa chỉ đoán mò rồi để người dùng thấy lỗi mạng
 * khó hiểu. Mọi giá trị thật nằm ở .env, xem .env.example.
 */
describe('VoiceService — cấu hình bắt buộc, không URL trong code', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  function buildService(configValues: Record<string, string> = {}) {
    const httpService: any = {
      get: jest.fn(() => of({ data: {} })),
      post: jest.fn(() => of({ data: {} })),
      delete: jest.fn(() => of({ data: { success: true } })),
    };
    const configService: any = {
      get: jest.fn((key: string, def?: string) =>
        configValues[key] !== undefined ? configValues[key] : def,
      ),
    };
    const service = new VoiceService(httpService, configService, {} as any, {} as any);
    return { service, httpService };
  }

  it('thiếu toàn bộ env URL → 503 và câu lỗi nêu đúng tên biến phải khai', async () => {
    const { service, httpService } = buildService();

    await expect(service.listVoices()).rejects.toMatchObject({ status: 503 });
    await expect(service.listVoices()).rejects.toThrow(/AI_SERVICE_URL/);
    // Chặn từ trước khi ra mạng — không được gọi thử vào đâu cả
    expect(httpService.get).not.toHaveBeenCalled();
  });

  it('generateTTS cũng bị chặn như vậy — mọi đường gọi AI đều qua một cửa kiểm', async () => {
    const { service, httpService } = buildService();

    await expect(service.generateTTS('xin chào', 'v1')).rejects.toMatchObject({ status: 503 });
    expect(httpService.post).not.toHaveBeenCalled();
  });

  it('chỉ cần AI_SERVICE_URL là chạy được ở local — không đòi hỏi biến voice riêng', async () => {
    const { service, httpService } = buildService({ AI_SERVICE_URL: 'http://localhost:8001' });

    await service.listVoices();

    expect(httpService.get.mock.calls[0][0]).toBe('http://localhost:8001/api/voice/list/');
  });

  it('KHÔNG có URL nào trong source của service — kể cả trong chuỗi lỗi/log', () => {
    // Đọc thẳng file nguồn: mọi chuỗi http/https literal đều bị cấm.
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'voice.service.ts'), 'utf8');
    const urls = (src.match(/https?:\/\/[^\s'"`]+/g) || []).filter(
      // Cho phép đúng một dạng: placeholder trong câu hướng dẫn (không có host thật)
      (u: string) => !u.includes('<service>'),
    );
    expect(urls).toEqual([]);
  });
});
