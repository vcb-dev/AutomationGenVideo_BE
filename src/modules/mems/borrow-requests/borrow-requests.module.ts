import { Module } from '@nestjs/common';
import { MemsPhotoUrlSigner } from '../../../common/mems/photo-url-signer.service';
import { MemsApprovalsModule } from '../approvals/approvals.module';
import { MemsAvailabilityModule } from '../availability/availability.module';
import { BorrowRequestService } from './borrow-request.service';
import { MemsBorrowRequestsController } from './borrow-requests.controller';
import { RequestExtrasService } from './request-extras.service';

@Module({
  imports: [MemsAvailabilityModule, MemsApprovalsModule],
  controllers: [MemsBorrowRequestsController],
  providers: [BorrowRequestService, RequestExtrasService, MemsPhotoUrlSigner],
})
export class MemsBorrowRequestsModule {}
