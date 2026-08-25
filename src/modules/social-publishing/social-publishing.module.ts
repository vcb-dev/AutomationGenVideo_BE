import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { InstagramScraperModule } from '../instagram-scraper/instagram-scraper.module';

// Upload
import { UploadController } from './upload/upload.controller';
import { UploadService } from './upload/upload.service';
import { MediaController } from './upload/media.controller';
import { GoogleDriveStorageService } from './upload/google-drive-storage.service';
import { MediaLibraryController } from './upload/media-library.controller';
import { MediaLibraryService } from './upload/media-library.service';
import { ChunkedUploadController } from './upload/chunked-upload.controller';
import { ThumbnailMigrationService } from './upload/thumbnail-migration.service';
import { CloudinaryStorageService } from './upload/cloudinary-storage.service';

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
import { ThreadsOAuthStrategy } from './oauth/strategies/threads.strategy';
import { YoutubeOAuthStrategy } from './oauth/strategies/youtube.strategy';

// Publish
import { PublishController } from './publish/publish.controller';
import { PublishService } from './publish/publish.service';
import { FacebookPublisher } from './publish/platforms/facebook.platform';
import { InstagramPublisher } from './publish/platforms/instagram.platform';
import { ThreadsPublisher } from './publish/platforms/threads.platform';
import { YoutubePublisher } from './publish/platforms/youtube.platform';

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

@Module({
  imports: [PrismaModule, MulterModule.register(), InstagramScraperModule],
  controllers: [
    UploadController,
    MediaController,
    MediaLibraryController,
    ChunkedUploadController,
    AccountsController,
    OAuthController,
    PublishController,
    ScheduleController,
    QueueController,
    HistoryController,
    DraftsController,
    HashtagController,
  ],
  providers: [
    // Core
    CryptoService,
    GoogleDriveStorageService,
    CloudinaryStorageService,
    UploadService,
    MediaLibraryService,
    ThumbnailMigrationService,
    // Accounts
    AccountsService,
    // OAuth
    OAuthService,
    FacebookOAuthStrategy,
    InstagramOAuthStrategy,
    ThreadsOAuthStrategy,
    YoutubeOAuthStrategy,
    // Publish
    PublishService,
    FacebookPublisher,
    InstagramPublisher,
    ThreadsPublisher,
    YoutubePublisher,
    // Schedule
    ScheduleService,
    // Queue
    QueueService,
    // History
    HistoryService,
    // Drafts
    DraftsService,
  ],
  exports: [AccountsService, PublishService, GoogleDriveStorageService, CloudinaryStorageService],
})
export class SocialPublishingModule {}
