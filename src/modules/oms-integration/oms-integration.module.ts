import { Global, Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { OmsIntegrationService } from './oms-integration.service';
import { OmsIntegrationController } from './oms-integration.controller';

@Global()
@Module({
  imports: [HttpModule.register({ timeout: 15000, maxRedirects: 5 }), ConfigModule],
  controllers: [OmsIntegrationController],
  providers: [OmsIntegrationService],
  exports: [OmsIntegrationService],
})
export class OmsIntegrationModule {}
