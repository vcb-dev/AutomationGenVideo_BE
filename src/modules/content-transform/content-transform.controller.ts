import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { ContentTransformService } from './content-transform.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { CreateTransformDto, HistoryQueryDto } from './dto';

@ApiTags('Content Transform')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('content-transform')
export class ContentTransformController {
  constructor(private readonly service: ContentTransformService) {}

  @Get('characters')
  @ApiOperation({ summary: 'Lấy danh sách các nhân vật đang active' })
  async getCharacters() {
    return this.service.getCharacters();
  }

  @Post('transform')
  @ApiOperation({ summary: 'Thực hiện chuyển đổi kịch bản bằng AI' })
  async transformContent(@Request() req: any, @Body() dto: CreateTransformDto) {
    return this.service.transformContent(req.user.id, dto);
  }

  @Post('transcribe')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 200 * 1024 * 1024 }, // 200MB limit
    }),
  )
  @ApiOperation({ summary: 'Chuyển đổi file video/audio thành văn bản' })
  async transcribeUpload(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Không tìm thấy file upload');
    }

    const ext = file.originalname.split('.').pop()?.toLowerCase() || '';
    const allowedExts = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'];
    if (!allowedExts.includes(ext)) {
      throw new BadRequestException('Chỉ chấp nhận các định dạng file video (mp4, mov, avi, mkv, webm) hoặc audio (mp3, wav, m4a, aac, ogg, flac).');
    }

    const isMimeOk = file.mimetype.startsWith('audio/') || file.mimetype.startsWith('video/');
    if (!isMimeOk) {
      throw new BadRequestException('Mimetype của file không hợp lệ.');
    }

    return this.service.transcribeUpload(file);
  }

  @Get('history')
  @ApiOperation({ summary: 'Lấy lịch sử chuyển đổi của chính user đang login' })
  async getUserHistory(@Request() req: any, @Query() query: HistoryQueryDto) {
    return this.service.getUserHistory(req.user.id, query);
  }

  @Get('history/member/:userId')
  @UseGuards(RolesGuard)
  @Roles(UserRole.LEADER, UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Lấy lịch sử chuyển đổi của 1 member cụ thể' })
  async getMemberHistory(
    @Request() req: any,
    @Param('userId') memberId: string,
    @Query() query: HistoryQueryDto,
  ) {
    return this.service.getMemberHistory(req.user.id, memberId, query, req.user.roles);
  }

  @Get('history/:id')
  @ApiOperation({ summary: 'Lấy chi tiết một bản ghi lịch sử chuyển đổi' })
  async getHistoryDetail(@Request() req: any, @Param('id') id: string) {
    return this.service.getHistoryDetail(id, req.user.id, req.user.roles);
  }
}
