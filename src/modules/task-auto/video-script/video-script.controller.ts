import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { JwtOrApiKeyGuard } from '../../api-keys/guards/jwt-or-api-key.guard'
import {
  GenerateVideoScriptDto,
  TranslateVideoScriptDto,
  UpdateVideoScriptDto,
} from './dto/video-script.dto'
import { VideoScriptService } from './video-script.service'

@ApiTags('task-auto')
@ApiBearerAuth()
@UseGuards(JwtOrApiKeyGuard)
@Controller('task-auto/tasks/:id/video-script')
export class VideoScriptController {
  constructor(private readonly videoScript: VideoScriptService) {}

  @Get()
  @ApiOperation({ summary: 'Lấy content AI đã sinh & cache cho task (nếu có)' })
  async getVideoScript(@Param('id') id: string) {
    const script = await this.videoScript.getCached(id)
    return { script }
  }

  @Post()
  @ApiOperation({
    summary:
      'Sinh content AI (DeepSeek) cho task. Dùng lại cache nếu input không đổi và force=false, tránh tốn token.',
  })
  generateVideoScript(
    @Param('id') id: string,
    @Body() dto: GenerateVideoScriptDto,
  ) {
    const { force, ...params } = dto
    return this.videoScript.generate(id, params, force ?? false)
  }

  @Patch()
  @ApiOperation({ summary: 'Sửa trực tiếp content/hashtags đã sinh (không gọi AI).' })
  async updateVideoScript(
    @Param('id') id: string,
    @Body() dto: UpdateVideoScriptDto,
  ) {
    const script = await this.videoScript.update(id, dto)
    return { script }
  }

  @Post('translate')
  @ApiOperation({ summary: 'Dịch content/hashtags hiện tại sang ngôn ngữ của thị trường.' })
  async translateVideoScript(
    @Param('id') id: string,
    @Body() dto: TranslateVideoScriptDto,
  ) {
    const script = await this.videoScript.translate(id, dto.market)
    return { script }
  }
}
