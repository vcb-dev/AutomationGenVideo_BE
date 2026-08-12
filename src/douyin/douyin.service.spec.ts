import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { DouyinService } from './douyin.service';

/**
 * DouyinService nhận HttpService + ConfigService qua constructor. Khung spec do `nest g` sinh ra
 * chỉ khai `providers: [DouyinService]`, nên Nest không dựng nổi instance và suite đỏ từ ngày
 * commit — phải khai mock cho ĐỦ dependency thì `Test.createTestingModule` mới compile được.
 */
describe('DouyinService', () => {
  let service: DouyinService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DouyinService,
        { provide: HttpService, useValue: { post: jest.fn(), get: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn((k: string) => (k === 'AI_SERVICE_URL' ? 'http://ai.test:8001' : undefined)) } },
      ],
    }).compile();

    service = module.get<DouyinService>(DouyinService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
