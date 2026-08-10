import { Test } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { VoiceModule } from '../voice.module';
import { VoiceController } from '../voice.controller';
import { VoiceService } from '../voice.service';
import { AiIntegrationModule } from '../../ai-integration/ai-integration.module';
import { AiIntegrationService } from '../../ai-integration/ai-integration.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * Chức năng: dây DI của VoiceModule sau khi tách khỏi AiIntegrationModule.
 *
 * Vì sao cần test riêng: lỗi DI của Nest KHÔNG hiện ra ở `tsc` lẫn unit test —
 * thiếu một provider trong module thì mọi thứ vẫn biên dịch sạch, test vẫn xanh,
 * và app chỉ nổ lúc khởi động ("Nest can't resolve dependencies of ..."). Tách
 * module là thao tác đụng thẳng vào dây DI nên phải có một test dựng thật container.
 *
 * VoiceController mượn AiIntegrationService (cho translate-text) — quan hệ chéo
 * module này chỉ chạy được nhờ AiIntegrationModule là @Global và export service đó.
 * Nếu ai bỏ @Global đi, test này đỏ chứ không phải production đỏ.
 */
describe('VoiceModule — dây DI dựng được thật', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  async function buildModule() {
    return Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        AiIntegrationModule,
        VoiceModule,
      ],
    })
      // Prisma thật sẽ mở kết nối DB khi khởi tạo — test này chỉ quan tâm dây DI.
      .overrideProvider(PrismaService)
      .useValue({ aiVoiceUsage: {}, paastAnalysisHistory: {} })
      .compile();
  }

  it('VoiceController dựng được — mọi dependency đều giải được', async () => {
    const moduleRef = await buildModule();

    expect(moduleRef.get(VoiceController)).toBeInstanceOf(VoiceController);

    await moduleRef.close();
  });

  it('VoiceService dựng được và VoiceModule export nó cho module khác dùng', async () => {
    const moduleRef = await buildModule();

    expect(moduleRef.get(VoiceService)).toBeInstanceOf(VoiceService);

    await moduleRef.close();
  });

  it('AiIntegrationService vẫn tới được từ VoiceModule — translate-text dựa vào quan hệ chéo này', async () => {
    const moduleRef = await buildModule();

    expect(moduleRef.get(AiIntegrationService)).toBeInstanceOf(AiIntegrationService);

    await moduleRef.close();
  });
});
