import { Body, Controller, Get, Post, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AvailabilityService } from './availability.service';
import { BorrowRequestService } from './borrow-request.service';
import { CheckAvailabilityQueryDto, CreateBorrowRequestDto } from './dto';

@ApiTags('MEMS — Mượn thiết bị')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('mems')
export class MemsBorrowController {
  constructor(
    private readonly availability: AvailabilityService,
    private readonly requests: BorrowRequestService,
  ) {}

  @Get('availability')
  @ApiOperation({ summary: 'Kiểm tra khả dụng theo khoảng thời gian (NV-07)' })
  check(@Query() query: CheckAvailabilityQueryDto) {
    return this.availability.check({
      modelId: query.modelId,
      fromTime: new Date(query.fromTime),
      toTime: new Date(query.toTime),
      quantity: query.quantity ?? 1,
    });
  }

  @Post('requests')
  @ApiOperation({ summary: 'Tạo phiếu mượn (NV-06)' })
  create(@Request() req: any, @Body() dto: CreateBorrowRequestDto) {
    return this.requests.create(req.user.id, dto);
  }
}
