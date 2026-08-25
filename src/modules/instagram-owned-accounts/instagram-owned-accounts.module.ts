import { Module } from '@nestjs/common';
import { InstagramOwnedAccountsService } from './instagram-owned-accounts.service';
import { InstagramOwnedAccountsController } from './instagram-owned-accounts.controller';
import { InstagramOwnedAccountsCronService } from './instagram-owned-accounts-cron.service';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { CryptoService } from '../social-publishing/crypto/crypto.service';

@Module({
  imports: [PrismaModule],
  controllers: [InstagramOwnedAccountsController],
  providers: [InstagramOwnedAccountsService, CryptoService, InstagramOwnedAccountsCronService],
  exports: [InstagramOwnedAccountsService],
})
export class InstagramOwnedAccountsModule {}
