import { Test, TestingModule } from '@nestjs/testing';
import { DouyinController } from './douyin.controller';
import { DouyinService } from './douyin.service';

/**
 * Cùng lý do với douyin.service.spec.ts: khung `nest g` không khai DouyinService nên controller
 * không dựng được. Mock thay vì import DouyinModule để test không kéo theo HttpModule/Config thật.
 */
describe('DouyinController', () => {
  let controller: DouyinController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DouyinController],
      providers: [{ provide: DouyinService, useValue: { searchVideos: jest.fn() } }],
    }).compile();

    controller = module.get<DouyinController>(DouyinController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
