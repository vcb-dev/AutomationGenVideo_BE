import { Module } from '@nestjs/common';
import { ApprovedContentController } from './approved-content.controller';
import { ApprovedContentService } from './approved-content.service';
import { PrismaModule } from '../../common/prisma/prisma.module';

@Module({
    imports: [PrismaModule],
    controllers: [ApprovedContentController],
    providers: [ApprovedContentService],
    exports: [ApprovedContentService],
})
export class ApprovedContentModule {}
