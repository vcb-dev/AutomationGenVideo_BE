import { Module } from '@nestjs/common';
import { VideoLibraryController } from './video-library.controller';
import { VideoLibraryService } from './video-library.service';
import { PrismaModule } from '../../common/prisma/prisma.module';

@Module({
    imports: [PrismaModule],
    controllers: [VideoLibraryController],
    providers: [VideoLibraryService],
    exports: [VideoLibraryService],
})
export class VideoLibraryModule {}
