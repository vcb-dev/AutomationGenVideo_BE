import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { AvailabilityService } from './availability.service';
import { CheckAvailabilityQueryDto } from './dto/availability.dto';

@ApiTags('MEMS — Mượn thiết bị')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('mems')
export class MemsAvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

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
}
