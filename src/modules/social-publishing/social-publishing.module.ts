import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { PrismaModule } from '../../common/prisma/prisma.module';

// Upload
import { UploadController } from './upload/upload.controller';
import { UploadService } from './upload/upload.service';
import { MediaController } from './upload/media.controller';
import { GoogleDriveStorageService } from './upload/google-drive-storage.service';
import { MediaLibraryController } from './upload/media-library.controller';
import { MediaLibraryService } from './upload/media-library.service';
import { ChunkedUploadController } from './upload/chunked-upload.controller';
import { InternalUploadController } from './upload/internal-upload.controller';

// Crypto
import { CryptoService } from './crypto/crypto.service';

// Accounts
import { AccountsController } from './accounts/accounts.controller';
import { AccountsService } from './accounts/accounts.service';

// OAuth
import { OAuthController } from './oauth/oauth.controller';
import { OAuthService } from './oauth/oauth.service';
import { FacebookOAuthStrategy } from './oauth/strategies/facebook.strategy';
import { InstagramOAuthStrategy } from './oauth/strategies/instagram.strategy';
import { TiktokOAuthStrategy } from './oauth/strategies/tiktok.strategy';
import { ThreadsOAuthStrategy } from './oauth/strategies/threads.strategy';
import { YoutubeOAuthStrategy } from './oauth/strategies/youtube.strategy';
import { ZaloOAuthStrategy } from './oauth/strategies/zalo.strategy';

// Publish
import { PublishController } from './publish/publish.controller';
import { PublishService } from './publish/publish.service';
import { FacebookPublisher } from './publish/platforms/facebook.platform';
import { InstagramPublisher } from './publish/platforms/instagram.platform';
import { TiktokPublisher } from './publish/platforms/tiktok.platform';
import { ThreadsPublisher } from './publish/platforms/threads.platform';
import { YoutubePublisher } from './publish/platforms/youtube.platform';
import { ZaloPublisher } from './publish/platforms/zalo.platform';

// Schedule
import { ScheduleController } from './schedule/schedule.controller';
import { ScheduleService } from './schedule/schedule.service';

// Queue
import { QueueController } from './queue/queue.controller';
import { QueueService } from './queue/queue.service';

// History
import { HistoryController } from './history/history.controller';
import { HistoryService } from './history/history.service';

// Drafts
import { DraftsController } from './drafts/drafts.controller';
import { DraftsService } from './drafts/drafts.service';

// Hashtag
import { HashtagController } from './hashtag/hashtag.controller';

// TikTok Clone
import { TiktokCloneController } from './tiktok-clone/tiktok-clone.controller';
import { TiktokCloneService } from './tiktok-clone/tiktok-clone.service';

// Extension serve (public — no auth)
import { ExtensionController } from './extension/extension.controller';

@Module({
  imports: [PrismaModule, MulterModule.register()],
  controllers: [
    UploadController,
    MediaController,
    MediaLibraryController,
    ChunkedUploadController,
    InternalUploadController,
    AccountsController,
    OAuthController,
    PublishController,
    ScheduleController,
    QueueController,
    HistoryController,
    DraftsController,
    HashtagController,
    TiktokCloneController,
    ExtensionController,
  ],
  providers: [
    // Core
    CryptoService,
    GoogleDriveStorageService,
    UploadService,
    MediaLibraryService,
    // Accounts
    AccountsService,
    // OAuth
    OAuthService,
    FacebookOAuthStrategy,
    InstagramOAuthStrategy,
    TiktokOAuthStrategy,
    ThreadsOAuthStrategy,
    YoutubeOAuthStrategy,
    ZaloOAuthStrategy,
    // Publish
    PublishService,
    FacebookPublisher,
    InstagramPublisher,
    TiktokPublisher,
    ThreadsPublisher,
    YoutubePublisher,
    ZaloPublisher,
    // Schedule
    ScheduleService,
    // Queue
    QueueService,
    // History
    HistoryService,
    // Drafts
    DraftsService,
    // TikTok Clone
    TiktokCloneService,
  ],
  exports: [AccountsService, PublishService, GoogleDriveStorageService],
})
export class SocialPublishingModule {}
