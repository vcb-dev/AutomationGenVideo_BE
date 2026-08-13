import { Controller, Post, Get, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PaastAnalyzerService } from './paast-analyzer.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AnalyzeContentDto, HistoryQueryDto } from './dto';

@ApiTags('PAAST Analyzer')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('paast-analyzer')
export class PaastAnalyzerController {
  constructor(private readonly service: PaastAnalyzerService) {}

  @Post('analyze')
  @ApiOperation({ summary: 'Phân tích content theo khung PAAST (5 lớp x 6 tiêu chí, thang điểm 100)' })
  async analyzeContent(@Request() req: any, @Body() dto: AnalyzeContentDto) {
    return this.service.analyzeContent(req.user.id, dto);
  }

  @Post('find-by-content')
  @ApiOperation({ summary: 'Tìm bản phân tích PAAST gần nhất khớp đúng nội dung này (mọi user) — tránh chấm điểm lại content không đổi, kể cả khi người khác đã chấm' })
  async findByContent(@Body() dto: AnalyzeContentDto) {
    return this.service.findLatestByContent(dto.content);
  }

  @Post('upgrade/:analysisId')
  @ApiOperation({ summary: 'Nâng cấp content dựa trên các tiêu chí đang thiếu của 1 bản phân tích đã lưu' })
  async upgradeAnalysis(@Request() req: any, @Param('analysisId') analysisId: string) {
    return this.service.upgradeAnalysis(req.user.id, analysisId);
  }

  @Get('history')
  @ApiOperation({ summary: 'Lấy lịch sử phân tích PAAST của chính user đang login' })
  async getUserHistory(@Request() req: any, @Query() query: HistoryQueryDto) {
    return this.service.getUserHistory(req.user.id, query);
  }

  @Get('history/:id')
  @ApiOperation({ summary: 'Lấy chi tiết một bản ghi lịch sử phân tích PAAST' })
  async getHistoryDetail(@Request() req: any, @Param('id') id: string) {
    return this.service.getHistoryDetail(id, req.user.id);
  }
}
