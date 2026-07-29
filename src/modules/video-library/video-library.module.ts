import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { VideoLibraryController } from './video-library.controller';
import { VideoProposalsController } from './video-proposals.controller';
import { VideoLibraryService } from './video-library.service';

// PushService (@Global, PushModule) và AiIntegrationService (@Global,
// AiIntegrationModule) đã có sẵn toàn cục — không cần import module của chúng ở đây.
@Module({
  imports: [PrismaModule],
  controllers: [VideoLibraryController, VideoProposalsController],
  providers: [VideoLibraryService],
})
export class VideoLibraryModule {}
