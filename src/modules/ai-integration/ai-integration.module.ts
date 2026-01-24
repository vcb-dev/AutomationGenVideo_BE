import { Module, Global } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { AiIntegrationService } from './ai-integration.service';

@Global() // Make it global so other modules can use it without importing
@Module({
  imports: [
    HttpModule.register({
      timeout: 30000, // 30 seconds timeout for AI operations
      maxRedirects: 5,
    }),
    ConfigModule,
  ],
  providers: [AiIntegrationService],
  exports: [AiIntegrationService],
})
export class AiIntegrationModule {}
