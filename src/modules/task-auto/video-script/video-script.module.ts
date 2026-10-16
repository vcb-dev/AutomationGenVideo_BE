import { Module } from '@nestjs/common'
import { PrismaModule } from '../../../common/prisma/prisma.module'
import { VideoScriptController } from './video-script.controller'
import { VideoScriptService } from './video-script.service'

@Module({
  imports: [PrismaModule],
  controllers: [VideoScriptController],
  providers: [VideoScriptService],
})
export class VideoScriptModule {}
