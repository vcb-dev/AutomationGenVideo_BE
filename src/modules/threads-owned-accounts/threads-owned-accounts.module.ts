import { Module } from '@nestjs/common';
import { ThreadsOwnedAccountsService } from './threads-owned-accounts.service';
import { ThreadsOwnedAccountsController } from './threads-owned-accounts.controller';
import { ThreadsOwnedAccountsCronService } from './threads-owned-accounts-cron.service';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { CryptoService } from '../social-publishing/crypto/crypto.service';

@Module({
  imports: [PrismaModule],
  controllers: [ThreadsOwnedAccountsController],
  providers: [ThreadsOwnedAccountsService, CryptoService, ThreadsOwnedAccountsCronService],
  exports: [ThreadsOwnedAccountsService],
})
export class ThreadsOwnedAccountsModule {}
