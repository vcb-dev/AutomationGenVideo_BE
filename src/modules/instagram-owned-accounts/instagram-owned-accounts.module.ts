import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { getRuntimeJwtSecret } from '../auth/jwt-secret.util';
import { InstagramOwnedAccountsController } from './instagram-owned-accounts.controller';
import { InstagramOwnedAccountsService } from './instagram-owned-accounts.service';
import { InstagramOwnedAiClientService } from './instagram-owned-ai-client.service';
import { InstagramOwnedAccountsCronService } from './instagram-owned-accounts-cron.service';

@Module({
  imports: [
    PrismaModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: getRuntimeJwtSecret(configService),
        signOptions: { expiresIn: '10m' },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [InstagramOwnedAccountsController],
  providers: [InstagramOwnedAccountsService, InstagramOwnedAiClientService, InstagramOwnedAccountsCronService],
  exports: [InstagramOwnedAccountsService],
})
export class InstagramOwnedAccountsModule {}
